/**
 * Setzt Farbschema und Zeilendichte, bevor das erste Pixel steht.
 *
 * Läuft als Text im `<head>` und damit vor React — sonst zeigte jede Seite
 * erst das helle, normale Bild und sprünge danach sichtbar um. Aus demselben
 * Grund steht hier kein Import: Wenn dieses Skript läuft, ist noch kein
 * Bundle geladen.
 *
 * `usePreference` schreibt die Werte mit `JSON.stringify`, in `localStorage`
 * steht also `"dark"` mitsamt Anführungszeichen. Wer sie roh ins Attribut
 * setzt, schreibt `data-color-scheme='"dark"'`, und keine CSS-Regel trifft
 * mehr zu — beide Präferenzen überlebten deshalb kein Neuladen. Gelesen wird
 * darum mit `JSON.parse`, und jede Präferenz für sich: Ein unlesbarer Wert
 * soll die andere nicht mitnehmen.
 *
 * Die Prüfung gegen die erlaubten Werte ist kein Ziselieren. Was hier ins
 * Attribut geht, landet ungefiltert in einem CSS-Selektor; ein Wert aus einem
 * alten Format oder von Hand gesetzt bliebe sonst als toter Zustand stehen.
 */
export const PREFERENCE_BOOTSTRAP = `(function(){
function read(key){try{var raw=localStorage.getItem('kompass.'+key);return raw===null?null:JSON.parse(raw)}catch(e){return null}}
try{var s=read('colorScheme');if(s!=='dark'&&s!=='light'){s=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-color-scheme',s)}catch(e){}
try{var d=read('density');if(d==='compact'||d==='default'||d==='comfortable'){document.documentElement.setAttribute('data-density',d)}}catch(e){}
})();`;
