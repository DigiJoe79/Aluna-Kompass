import { completeFollowUp, isoDayIn, isoNow, newId, seedClockAt, seedMoment, seedStoryYear, storyDay, todayIn, unwrap, type CallContext, type Deps } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { and, eq } from 'drizzle-orm';
import { EXAMPLE_DOCUMENT_TYPES } from './catalog';
import { recordDispatch } from './dispatch';
import { createDocumentFollowUp } from './follow-ups';
import { createDraft, fileDocument } from './drafts';
import { receiveDocument, reclassifyDocument } from './incoming';
import { DEFAULT_TYPE_INCOMING } from './install';
import { addNote } from './notes';
import { relateDocuments } from './relations';
import { documentFolders, documentRules, documentSnippets, documents, documentTypes, type RelationKind } from './schema';
import { textPdf } from './seed-pdf';
import { createSnippet } from './snippets';

/** Tage relativ zum Seed-Lauf — die Beispiele sollen nie „schon vorbei“ wirken. */
const addDays = (deps: Deps, days: number) => isoDayIn(deps, deps.clock.now().getTime() + days * 86_400_000);

type LinkRole = 'sender' | 'recipient' | 'about';
interface LinkInput { entityType: string; entityId: string; role: LinkRole }
type Party = { name: string } | { firstName: string; lastName: string };

/** Ein Kontakt aus dem Kontakte-Seed; ohne ihn (Modultest ohne Kontakte) bleibt das Dokument ohne Bezug. */
function contactOf(deps: Deps, who: Party): string | null {
  const row =
    'name' in who
      ? deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.name, who.name)).get()
      : deps.db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.firstName, who.firstName), eq(contacts.lastName, who.lastName))).get();
  return row?.id ?? null;
}

const linkTo = (contactId: string | null, role: LinkRole): LinkInput[] => (contactId ? [{ entityType: 'contact', entityId: contactId, role }] : []);

/** Ein Schritt der Geschichte: was zu einem Zeitpunkt geschieht. Die Schritte laufen nach Zeit sortiert, damit Nummern in der Reihenfolge der Daten wachsen. */
interface Step {
  at: Date;
  run: (d: Deps) => Promise<void>;
}

// — Texte. Briefe sind Markdown (Typst setzt sie); Eingänge sind `textPdf`, also nur Latin-1. —

/** Der Antrag zum Jahr `y − 2` — Erklärung und Bescheid hängen am Stichjahr, nie an einer festen Zahl. */
const antrag = (year: number) => 'Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die Körperschaftsteuererklärung des Musterverein e.V. für das Jahr ' + year + ' mit Tätigkeitsbericht, Kassenbericht und dem Protokoll der Mitgliederversammlung.\n\nWir bitten um Prüfung und um einen Bescheid über die Freistellung für diesen Zeitraum. Rückfragen beantwortet unser Schatzmeister gern.\n\nMit freundlichen Grüßen\n\nDer Vorstand';

const EINLADUNG = 'Sehr geehrte Damen und Herren,\n\nhiermit laden wir Sie herzlich zur ordentlichen Mitgliederversammlung ein.\n\n**Tagesordnung**\n\n1. Bericht des Vorstands\n2. Kassenbericht und Bericht der Kassenprüfung\n3. Entlastung des Vorstands\n4. Wahl des Vorstands\n5. Verschiedenes\n\nAnträge zur Tagesordnung reichen Sie bitte bis spätestens zwei Wochen vor der Versammlung schriftlich ein.\n\nMit freundlichen Grüßen\n\nDer Vorstand';

const bescheid = (year: number) => [
  'Finanzamt Musterstadt',
  'Steuernummer 99/999/99999',
  '',
  'Musterverein e.V.',
  'Vereinsweg 1, 12345 Musterstadt',
  '',
  `Freistellungsbescheid für ${year}`,
  '',
  'Der Verein verfolgt ausschließlich und unmittelbar gemeinnützige Zwecke',
  'im Sinne der Abgabenordnung, nämlich die Förderung des Tierschutzes',
  'und der Jugendhilfe. Er ist von der Körperschaftsteuer und der',
  'Gewerbesteuer befreit.',
  '',
  'Die Satzung entspricht den Anforderungen des Gemeinnützigkeitsrechts.',
  'Bitte bewahren Sie diesen Bescheid zu den Vereinsunterlagen.',
  '',
  'Mit freundlichen Grüßen',
  'Ihr Finanzamt Musterstadt',
  '',
  '',
  'Rechtsbehelfsbelehrung: Gegen diesen Bescheid ist der Einspruch zulässig.',
  'Er ist binnen eines Monats nach Bekanntgabe beim Finanzamt einzulegen.',
];

const DANK = 'Sehr geehrte Damen und Herren,\n\nvielen Dank für die kurzfristige Behandlung unseres Pflegehundes am vergangenen Wochenende. Ohne Ihre schnelle Hilfe wäre der Abend anders ausgegangen.\n\nMit freundlichen Grüßen\n\nDer Vorstand';

const ANFRAGE = 'Sehr geehrte Damen und Herren,\n\nfür unsere Kastrationsaktion im Frühsommer suchen wir eine Praxis, die eine Woche lang freilebende Katzen aus der Region versorgt. Wir rechnen mit etwa 40 Tieren.\n\nKönnten Sie uns mögliche Termine und einen Kostenrahmen nennen? Fang, Transport und Nachsorge übernehmen unsere Helferinnen und Helfer.\n\nMit freundlichen Grüßen\n\nDer Vorstand';

const ANGEBOT = [
  'Tierarztpraxis am Stadtpark',
  'Parkstraße 5, 12345 Musterstadt',
  '',
  'Angebot Kastrationsaktion',
  '',
  'Vielen Dank für Ihre Anfrage. Wir können die Aktion in der',
  'zweiten Juniwoche übernehmen.',
  '',
  'Kastration Kätzin, je Tier         95,00 EUR',
  'Kastration Kater, je Tier          55,00 EUR',
  'Kennzeichnung und Registrierung    12,00 EUR',
  '',
  'Bei 40 Tieren gewähren wir 10 Prozent Nachlass.',
  'Wir freuen uns auf die Zusammenarbeit.',
];

const AUFTRAG = 'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihr Angebot. Wir beauftragen Sie hiermit mit der Kastrationsaktion in der zweiten Juniwoche zu den genannten Preisen und mit dem angebotenen Nachlass.\n\nDie Tiere bringen wir täglich bis 9 Uhr; die Nachsorge übernehmen unsere Pflegestellen.\n\nMit freundlichen Grüßen\n\nDer Vorstand';

const PFLEGEVERTRAG = [
  'Pflegestellenvertrag',
  '',
  'zwischen Musterverein e.V. und Sabine Krämer, Wiesenweg 9, 12347 Musterstadt',
  '',
  '1. Die Pflegestelle nimmt Hunde des Vereins bis zur Vermittlung auf.',
  '2. Futter und Tierarztkosten trägt der Verein.',
  '3. Die Pflegestelle meldet Auffälligkeiten innerhalb eines Tages.',
  '',
  'Musterstadt, unterschrieben von beiden Seiten.',
];

const MV_PROTOKOLL = '## Mitgliederversammlung\n\nBeginn 19:00 Uhr, 23 stimmberechtigte Mitglieder anwesend. Die Versammlung ist ordnungsgemäß eingeladen und beschlussfähig.\n\n### Berichte\n\nDer Vorstand berichtet über 31 Vermittlungen, die Winterhilfe und die Kastrationsaktion. Der Kassenbericht schließt mit einem Überschuss; die Kassenprüfung hat keine Beanstandungen.\n\n### Beschlüsse\n\n1. Der Vorstand wird einstimmig entlastet.\n2. **Clara Neumann** wird zur Vorsitzenden gewählt (21 Ja, 2 Enthaltungen). Bernd Hagedorn kandidiert nicht erneut; die Versammlung dankt ihm für drei Jahre Vorstandsarbeit.\n3. Der Mitgliedsbeitrag bleibt unverändert.\n\nEnde 20:40 Uhr.';

const ANMELDUNG = 'Sehr geehrte Damen und Herren,\n\nzur Eintragung in das Vereinsregister melden wir die Änderung des Vorstands an: Die Mitgliederversammlung hat Frau Clara Neumann zur Vorsitzenden gewählt; Herr Bernd Hagedorn ist aus dem Vorstand ausgeschieden.\n\nDas Protokoll der Versammlung liegt bei, die Unterschriften sind öffentlich beglaubigt.\n\nMit freundlichen Grüßen\n\nDer Vorstand';

const EINTRAGUNG = [
  'Amtsgericht Musterstadt',
  'Registergericht',
  '',
  'Vereinsregister VR 4711',
  'Musterverein e.V.',
  '',
  'Eintragungsnachricht',
  '',
  'Die angemeldete Änderung des Vorstands wurde in das',
  'Vereinsregister eingetragen. Ein aktueller Auszug liegt bei.',
];

const ADRESSE = [
  'Jakob Brenner',
  'Mühlgasse 3, 12345 Musterstadt',
  '',
  'Neue Anschrift',
  '',
  'Liebes Vereinsteam,',
  'ab dem nächsten Monat wohne ich in der Mühlgasse 3. Bitte',
  'schickt Post und den Rundbrief ab sofort dorthin.',
  '',
  'Viele Grüße, Jakob Brenner',
];

const RUNDSCHREIBEN = [
  'Landesverband Musterland e.V.',
  '',
  'Rundschreiben an die Mitgliedsvereine',
  '',
  'Im Herbst bieten wir drei Fortbildungen an: Erste Hilfe am Hund,',
  'Vereinsrecht für Vorstände und Öffentlichkeitsarbeit mit kleinem',
  'Budget. Anmeldungen bitte bis Ende August.',
];

const ANFORDERUNG = [
  'Finanzamt Musterstadt',
  'Steuernummer 99/999/99999',
  '',
  'Anforderung von Unterlagen',
  '',
  'Für die Prüfung der Zuwendungsbestätigungen des Vorjahres',
  'bitten wir um Zusendung der Doppel der ausgestellten',
  'Bestätigungen und der zugehörigen Kontoauszüge.',
];

const UNTERLAGEN = 'Sehr geehrte Damen und Herren,\n\nwie angefordert senden wir Ihnen die Doppel der Zuwendungsbestätigungen des Vorjahres und die zugehörigen Kontoauszüge.\n\nMit freundlichen Grüßen\n\nDer Vorstand';

const NETZWERK = [
  'Landesverband Musterland e.V.',
  '',
  'Netzwerktreffen im Herbst',
  '',
  'Wir laden alle Mitgliedsvereine zu unserem Netzwerktreffen ein.',
  'Themen: Pflegestellen gewinnen, Zusammenarbeit mit Tierärzten,',
  'gemeinsame Spendenaktionen. Bitte gebt uns bis Monatsende Bescheid.',
];

const BAXTER = [
  'Mira Sandberg',
  'Ahornweg 4, 12345 Musterstadt',
  '',
  'Anfrage zu Baxter',
  '',
  'Hallo,',
  'wir haben Baxter auf Ihrer Webseite gesehen. Wir haben einen',
  'Garten und viel Zeit für Spaziergänge. Wäre ein Kennenlernen',
  'möglich?',
  '',
  'Viele Grüße, Mira Sandberg',
];

const ZUSAGE = 'Liebes Team des Landesverbands,\n\nvielen Dank für die Einladung. Wir kommen gern zum Netzwerktreffen, voraussichtlich zu zweit, und bringen Erfahrungen aus unserer Kastrationsaktion mit.\n\nViele Grüße\n\nDer Vorstand';

const WINTERBRIEF = '### Winterhilfe: Wir brauchen Sie\n\nLiebe Sabine,\n\nab November betreuen wir wieder fünf Futterstellen in und um Musterstadt. Im letzten Winter hast Du uns sehr geholfen — deshalb fragen wir Dich als Erste.\n\nWas wir in diesem Jahr brauchen:\n\n- eine Person, die mittwochs die Futterstelle am Bahndamm übernimmt\n- zwei Schlafboxen, die bei Dir im Schuppen überwintern dürfen\n- Hilfe beim Aufbau am **zweiten Samstag im November**\n\nFutter, Stroh und Decken stellt der Verein; die Fahrtkosten erstatten wir wie gewohnt über die Auslagen.\n\nMagst Du uns bis Ende des Monats Bescheid geben, was davon für Dich passt? Wir freuen uns über jede Hilfe, auch wenn es nur ein Punkt ist.\n\nHerzliche Grüße';

export async function seedDms(deps: Deps, ctx: CallContext): Promise<void> {
  const existing = deps.db.select({ id: documents.id }).from(documents).all();
  if (existing.length > 0) return;
  // Das Stichjahr; die Briefe aus 0.1 liegen im Januar bis März darin (Befund 0.2.8/20).
  const y = seedStoryYear(todayIn(deps));

  // Die beiden unklassifizierten Arten stehen schon: `installDms` hat sie beim
  // Einschalten angelegt. Hier kommen nur die Beispiele dazu, die noch fehlen —
  // je Schlüssel, nicht alles oder nichts.
  const existingKeys = new Set(deps.db.select({ key: documentTypes.key }).from(documentTypes).all().map((row) => row.key));
  let sortOrder = existingKeys.size;
  for (const type of EXAMPLE_DOCUMENT_TYPES) {
    if (existingKeys.has(type.key)) continue;
    deps.db.insert(documentTypes).values({ ...type, sortOrder: sortOrder += 1 }).run();
  }

  // Eltern vor Kindern; drei Ebenen und ein langer Name zeigen den Baum.
  const folders = [
    'behoerden',
    'behoerden/finanzamt',
    'behoerden/amtsgericht',
    `behoerden/amtsgericht/vereinsregister-${y}`,
    'vertraege',
    'protokolle',
    'korrespondenz-mit-dem-landesverband-und-den-kreisgruppen',
    'mitglieder',
    'partner',
    'partner/pflegestellen',
    'partner/tieraerzte',
  ];
  for (const path of folders) {
    const existingFolder = deps.db.select().from(documentFolders).where(eq(documentFolders.path, path)).get();
    if (!existingFolder) {
      deps.db.insert(documentFolders).values({ path, createdAt: isoNow(deps.clock) }).run();
    }
  }

  const existingRule = deps.db.select().from(documentRules).where(eq(documentRules.matchContains, 'Finanzamt')).get();
  if (!existingRule) {
    deps.db.insert(documentRules).values({
      id: newId(),
      matchField: 'filename',
      matchContains: 'Finanzamt',
      thenTypeKey: 'authority',
      thenFolder: 'behoerden/finanzamt',
      isActive: true,
      sortOrder: 0,
    }).run();
  }

  const who = {
    // Der erste Kontakt bleibt Empfänger der Einladung wie seit 0.1.
    first: deps.db.select({ id: contacts.id }).from(contacts).limit(1).get()?.id ?? null,
    finanzamt: contactOf(deps, { name: 'Finanzamt Musterstadt' }),
    amtsgericht: contactOf(deps, { name: 'Amtsgericht Musterstadt' }),
    praxis: contactOf(deps, { name: 'Tierarztpraxis am Stadtpark' }),
    landesverband: contactOf(deps, { name: 'Landesverband Musterland e.V.' }),
    sabine: contactOf(deps, { firstName: 'Sabine', lastName: 'Krämer' }),
    jakob: contactOf(deps, { firstName: 'Jakob', lastName: 'Brenner' }),
    clara: contactOf(deps, { firstName: 'Clara', lastName: 'Neumann' }),
    bernd: contactOf(deps, { firstName: 'Bernd', lastName: 'Hagedorn' }),
    mira: contactOf(deps, { firstName: 'Mira', lastName: 'Sandberg' }),
  };

  const doc: Record<string, string> = {};
  const id = (key: string) => {
    const value = doc[key];
    if (!value) throw new Error(`Seed-Dokument fehlt: ${key}`);
    return value;
  };
  const story = (monthDay: string, time = '09:00') => seedMoment(deps, storyDay(deps, monthDay), time);
  const minutesAgo = (minutes: number) => new Date(deps.clock.now().getTime() - minutes * 60_000);

  const write = async (d: Deps, key: string, o: { subject: string; body: string; folder: string | null; links: LinkInput[]; typeKey?: string; file?: boolean }) => {
    const draft = unwrap(await createDraft(d, ctx, { typeKey: o.typeKey ?? 'letter', subject: o.subject, body: o.body, documentDate: todayIn(d), folder: o.folder, links: o.links }));
    if (o.file !== false) unwrap(await fileDocument(d, ctx, { id: draft.id }));
    doc[key] = draft.id;
  };
  const receive = async (d: Deps, key: string, o: { filename: string; typeKey: string; subject: string; lines: readonly string[]; folder: string | null; links: LinkInput[]; repliesTo?: string }) => {
    const relations = o.repliesTo ? [{ relatedDocumentId: id(o.repliesTo), kind: 'repliesTo' as const }] : [];
    doc[key] = unwrap(await receiveDocument(d, ctx, { filename: o.filename, bytes: textPdf(o.lines), typeKey: o.typeKey, subject: o.subject, documentDate: todayIn(d), folder: o.folder, links: o.links, relations })).id;
  };
  const dispatch = async (d: Deps, key: string, sentVia: 'post' | 'email' | 'portal', note?: string) => {
    unwrap(await recordDispatch(d, ctx, { id: id(key), sentAt: todayIn(d), sentVia, ...(note ? { note } : {}) }));
  };
  const relate = async (d: Deps, from: string, to: string, kind: RelationKind) => {
    unwrap(await relateDocuments(d, ctx, { documentId: id(from), relatedDocumentId: id(to), kind }));
  };

  // Ein Eingang, erst ohne passende Art abgelegt und dann umklassifiziert (Spec 2026-09-19). Die Art
  // „unklassifiziert“ legt die Installation an; fehlt sie, wird mit der ersten Eingangsart abgelegt.
  const firstType = deps.db.select().from(documentTypes).where(eq(documentTypes.key, DEFAULT_TYPE_INCOMING)).get()?.key ?? 'authority';
  const praxis = linkTo(who.praxis, 'recipient');
  const vorstand = [...linkTo(who.clara, 'about'), ...linkTo(who.bernd, 'about')];

  const steps: Step[] = [
    // — Die Briefe aus 0.1, Januar bis März des Stichjahrs: E2E-Tests lesen Betreff, Datum (10.02., 15.02., über
    //   `story()`) und Ort. Das Schreiben ans Finanzamt hängt am Bescheid, der darauf antwortet. —
    { at: story('01-12'), run: async (d) => { await write(d, 'antrag', { subject: `Steuererklärung ${y - 2} und Antrag auf Freistellung`, body: antrag(y - 2), folder: 'behoerden/finanzamt', links: linkTo(who.finanzamt, 'recipient') }); await dispatch(d, 'antrag', 'portal'); } },
    {
      at: story('01-20'),
      run: async (d) => {
        await receive(d, 'mietvertrag', { filename: `${y}-01-20 Mietvertrag Lager.pdf`, typeKey: firstType, subject: 'Mietvertrag Lagerraum', lines: ['Mietvertrag', '', `über den Lagerraum im Hof, Beginn 1. Februar ${y}.`], folder: 'vertraege', links: [] });
        unwrap(await reclassifyDocument(d, ctx, { id: id('mietvertrag'), typeKey: 'contract' }));
      },
    },
    { at: story('02-10'), run: (d) => write(d, 'einladung', { subject: 'Einladung zur ordentlichen Mitgliederversammlung', body: EINLADUNG, folder: `behoerden/amtsgericht/vereinsregister-${y}`, links: linkTo(who.first, 'recipient') }) },
    { at: story('02-12'), run: (d) => dispatch(d, 'einladung', 'post', 'mit Anmeldeformular') },
    {
      // Im Eingangskorb, ohne Absender (E2E `dms.spec.ts:1251` setzt beides selbst). Die Textebene liest der Worker.
      at: story('02-15'),
      run: async (d) => {
        await receive(d, 'bescheid', { filename: `${y}-02-15 Bescheid.pdf`, typeKey: 'authority', subject: 'Freistellungsbescheid', lines: bescheid(y - 2), folder: null, links: [], repliesTo: 'antrag' });
        unwrap(await addNote(d, ctx, { documentId: id('bescheid'), body: 'Bescheid liegt im Original im Ordner Behörden, Fach 3.' }));
      },
    },
    // Festgeschrieben und bewusst nicht versandt — die Liste soll beides zeigen.
    { at: story('03-02'), run: (d) => write(d, 'dank', { subject: 'Dankschreiben an die Tierarztpraxis', body: DANK, folder: null, links: praxis }) },

    // — Das Stichjahr (Spec 2026-10-06 § 4): Praxis, Pflegestelle, Versammlung, Register, Finanzamt. —
    { at: story('03-04'), run: async (d) => { await write(d, 'anfrage', { subject: 'Anfrage Kastrationsaktion: Termine und Kosten', body: ANFRAGE, folder: 'partner/tieraerzte', links: praxis }); await dispatch(d, 'anfrage', 'email'); } },
    { at: story('03-18'), run: (d) => receive(d, 'angebot', { filename: 'Angebot Kastrationsaktion.pdf', typeKey: 'letter', subject: 'Angebot Kastrationsaktion', lines: ANGEBOT, folder: 'partner/tieraerzte', links: linkTo(who.praxis, 'sender'), repliesTo: 'anfrage' }) },
    { at: story('03-25'), run: async (d) => { await write(d, 'auftrag', { subject: 'Auftrag Kastrationsaktion', body: AUFTRAG, folder: 'partner/tieraerzte', links: praxis }); await relate(d, 'auftrag', 'angebot', 'repliesTo'); await dispatch(d, 'auftrag', 'email'); } },
    // Ein Protokoll, das jemand angefangen und liegen gelassen hat (E2E `dms.spec.ts:674` sucht die Zeile).
    { at: story('04-02'), run: (d) => write(d, 'entwurfVorstand', { typeKey: 'minutes', subject: 'Protokoll Vorstandssitzung Quartal 1', body: '## Tagesordnung\n\n1. Begrüßung\n2. Berichte\n3. Verschiedenes', folder: 'protokolle', links: [], file: false }) },
    { at: story('04-08'), run: (d) => receive(d, 'pflegevertrag', { filename: 'Pflegestellenvertrag.pdf', typeKey: 'contract', subject: 'Pflegestellenvertrag', lines: PFLEGEVERTRAG, folder: 'partner/pflegestellen', links: linkTo(who.sabine, 'sender') }) },
    { at: story('04-29', '18:00'), run: (d) => write(d, 'mvProtokoll', { typeKey: 'minutes', subject: 'Protokoll der Mitgliederversammlung', body: MV_PROTOKOLL, folder: 'protokolle', links: vorstand }) },
    { at: story('05-27'), run: async (d) => { await write(d, 'anmeldung', { subject: 'Anmeldung der Vorstandsänderung zum Vereinsregister', body: ANMELDUNG, folder: 'behoerden/amtsgericht', links: [...linkTo(who.amtsgericht, 'recipient'), ...vorstand] }); await relate(d, 'mvProtokoll', 'anmeldung', 'attachmentOf'); } },
    { at: story('05-28'), run: (d) => dispatch(d, 'anmeldung', 'post', 'mit beglaubigten Unterschriften') },
    {
      at: story('06-16'),
      run: async (d) => {
        await receive(d, 'eintragung', { filename: 'Eintragungsnachricht.pdf', typeKey: 'authority', subject: 'Eintragungsnachricht Vereinsregister', lines: EINTRAGUNG, folder: 'behoerden/amtsgericht', links: linkTo(who.amtsgericht, 'sender'), repliesTo: 'anmeldung' });
        unwrap(await addNote(d, ctx, { documentId: id('eintragung'), body: 'Registerauszug liegt im Vereinsordner.' }));
      },
    },
    { at: story('07-02'), run: (d) => receive(d, 'adresse', { filename: 'Neue Anschrift.pdf', typeKey: 'letter', subject: 'Mitteilung neue Anschrift', lines: ADRESSE, folder: 'mitglieder', links: linkTo(who.jakob, 'sender') }) },
    { at: story('07-14'), run: (d) => receive(d, 'rundschreiben', { filename: 'Rundschreiben Fortbildungen.pdf', typeKey: 'letter', subject: 'Rundschreiben: Fortbildungen im Herbst', lines: RUNDSCHREIBEN, folder: 'korrespondenz-mit-dem-landesverband-und-den-kreisgruppen', links: linkTo(who.landesverband, 'sender') }) },
    { at: story('07-21'), run: (d) => receive(d, 'anforderung', { filename: 'Anforderung Unterlagen.pdf', typeKey: 'authority', subject: 'Anforderung von Unterlagen zu Zuwendungsbestätigungen', lines: ANFORDERUNG, folder: 'behoerden/finanzamt', links: linkTo(who.finanzamt, 'sender') }) },
    { at: story('07-30'), run: async (d) => { await write(d, 'unterlagen', { subject: 'Unterlagen zu den Zuwendungsbestätigungen', body: UNTERLAGEN, folder: 'behoerden/finanzamt', links: linkTo(who.finanzamt, 'recipient') }); await relate(d, 'unterlagen', 'anforderung', 'repliesTo'); await dispatch(d, 'unterlagen', 'post'); } },

    // — Heute: die Post des Tages. Über ihr stehen nur die Finanz-Dokumente, die der Finanz-Seed heute ausstellt
    //   (Ausnahmen in Plan 2b, Task 7); alles andere liegt an seinem Datum darunter (Review Focus 3). —
    { at: minutesAgo(50), run: (d) => receive(d, 'netzwerk', { filename: 'Netzwerktreffen.pdf', typeKey: 'letter', subject: 'Netzwerktreffen im Herbst: Einladung des Landesverbands', lines: NETZWERK, folder: null, links: linkTo(who.landesverband, 'sender') }) },
    { at: minutesAgo(40), run: (d) => receive(d, 'baxter', { filename: 'Anfrage Baxter.pdf', typeKey: 'letter', subject: 'Anfrage zu Baxter', lines: BAXTER, folder: null, links: linkTo(who.mira, 'sender') }) },
    { at: minutesAgo(30), run: async (d) => { await write(d, 'zusage', { subject: 'Zusage Netzwerktreffen', body: ZUSAGE, folder: 'korrespondenz-mit-dem-landesverband-und-den-kreisgruppen', links: linkTo(who.landesverband, 'recipient') }); await relate(d, 'zusage', 'netzwerk', 'repliesTo'); await dispatch(d, 'zusage', 'email'); } },
    // Der Entwurf für „Brief mit Text und Vorschau“ (§ 5.5): Überschrift, Aufzählung, Fettdruck, Empfänger.
    { at: minutesAgo(20), run: (d) => write(d, 'winterbrief', { subject: 'Winterhilfe: Bitte um Unterstützung', body: WINTERBRIEF, folder: 'partner/pflegestellen', links: linkTo(who.sabine, 'recipient'), file: false }) },
  ];
  for (const step of [...steps].sort((a, b) => a.at.getTime() - b.at.getTime())) await step.run(seedClockAt(deps, step.at));

  // Bausteine je Name — der Abbruch oben zählt Dokumente, nicht Bausteine.
  for (const snippet of [
    { name: 'Grußformel', body: 'Mit freundlichen Grüßen\n\nDer Vorstand' },
    { name: 'Bitte um Rückmeldung', subject: 'Bitte um Rückmeldung', body: 'Wir bitten um Ihre Rückmeldung bis zum genannten Termin.' },
  ]) {
    const exists = deps.db.select().from(documentSnippets).where(eq(documentSnippets.name, snippet.name)).get();
    if (!exists) unwrap(await createSnippet(deps, ctx, snippet));
  }

  // Wiedervorlagen relativ zu heute: eine offene und eine erledigte an der Einladung (E2E „Antwort abwarten“),
  // eine weitere jenseits der sieben Tage der Vorgabe-Kachel und ohne Zuständige — „Fällig“ der Verwaltung
  // zeigt weiter nur „Antwort abwarten“ (`follow-ups.spec.ts:18`, `:31`).
  unwrap(await createDocumentFollowUp(deps, ctx, { documentId: id('einladung'), dueAt: addDays(deps, 5), title: 'Antwort abwarten' }));
  const done = unwrap(await createDocumentFollowUp(deps, ctx, { documentId: id('einladung'), dueAt: addDays(deps, -3), title: 'Unterlagen beilegen' }));
  unwrap(await completeFollowUp(deps, ctx, { id: done.id }));
  unwrap(await createDocumentFollowUp(deps, ctx, { documentId: id('baxter'), dueAt: addDays(deps, 12), title: 'Kennenlernen auf der Pflegestelle vereinbaren' }));
}
