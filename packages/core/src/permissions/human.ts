import type { CallContext } from '../context';
import type { Deps } from '../deps';
import { conflict, type Failure } from '../result';
import { readSetting } from '../settings/service';

/**
 * Für Dienste, die nur ein Mensch auslösen soll — festschreiben, freigeben,
 * abschließen, ausstellen. Das MCP-Werkzeug bleibt (Prinzip 8) und nennt die
 * Sperre in seiner Beschreibung; ob ein Verein sie aufhebt, entscheidet er
 * über eine Einstellung des Moduls, die selbst nur über die Oberfläche
 * änderbar ist (`uiOnly`).
 */
export function requireHumanChannel(deps: Deps, ctx: CallContext, settingKey: string): Failure | null {
  if (ctx.channel !== 'mcp') return null;
  return readSetting<boolean>(deps, settingKey) === true ? null : conflict('humanOnly', settingKey);
}
