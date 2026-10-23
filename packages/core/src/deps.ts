import type Database from 'better-sqlite3';
import type { BackupMountWarning } from './backup/paths';
import type { Clock } from './clock';
import type { Db } from './db/client';
import type { DocumentEngine } from './documents/engine';
import type { FileStore } from './files/store';
import type { MailTransport } from './mail';
import type { Registry } from './modules/registry';
import type { PdfTools } from './pdf/tools';
import type { TextExtraction } from './text/extraction';

export type AppEnv = 'development' | 'test' | 'production';

export interface Deps {
  db: Db;
  sqlite: Database.Database;
  clock: Clock;
  env: AppEnv;
  registry: Registry;
  media: FileStore;
  /**
   * Der Dateispeicher eines Moduls, das `files: true` deklariert. Wirft für
   * jedes andere — ein Modul, das Dateien ablegt, ohne es anzumelden, wäre
   * sonst nicht im Backup.
   */
  files(moduleKey: string): FileStore;
  documents: DocumentEngine;
  /**
   * Texterkennung als Werkzeug des Containers, nicht als Fachlichkeit: Der Kern
   * besitzt, was außerhalb des Prozesses liegt, und reicht es durch. Er ruft es
   * selbst nie — heute benutzt es nur `dms`.
   */
  textExtraction: TextExtraction;
  /**
   * PDF-Werkzeuge des Containers (`pdfunite`), durchgereicht wie die
   * Texterkennung. Der Kern ruft sie selbst nie — heute benutzt sie nur `finance`.
   */
  pdf: PdfTools;
  /**
   * Mailversand (`nodemailer` in der App), durchgereicht wie die Texterkennung.
   * Der Kern ruft ihn selbst nie — heute benutzt ihn nur `dms`.
   */
  mail: MailTransport;
  /** Gepflegte Sprachen, erste ist Leitsprache. Als Funktion, damit eine Änderung sofort wirkt. */
  locales: () => string[];
  /**
   * K2: übersetzt die Bezeichnung eines Halters, Verweises oder Datensatzes (`LabelRef`) mit der Sprachdatei. Die App
   * belegt es; ohne Angabe (Tests, Skripte) bleibt es bei Schlüssel und Parametern (`resolveLabel`).
   */
  labels?: (key: string, params: Record<string, string | number>) => string;
  /**
   * Betriebsparameter: das Verzeichnis der Backups und ob es eingehängt ist. Nur `AppDeps` belegt sie;
   * die Kachel und die Hauswirtschaft lesen sie über `Deps`.
   */
  backupPath?: string | null;
  backupMountWarning?: BackupMountWarning;
}
