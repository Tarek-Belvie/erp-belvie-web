// Équivalents SÉQUENTIELS des méthodes de tableau, pour des callbacks asynchrones.
// Séquentiels à dessein : à l'intérieur d'une transaction, l'ordre des requêtes reste celui du code
// d'origine (Promise.all lancerait tout en même temps).
async function mapSeq(arr, fn) { const out = []; for (let i = 0; i < arr.length; i++) out.push(await fn(arr[i], i, arr)); return out; }
async function filterSeq(arr, fn) { const out = []; for (let i = 0; i < arr.length; i++) if (await fn(arr[i], i, arr)) out.push(arr[i]); return out; }
async function someSeq(arr, fn) { for (let i = 0; i < arr.length; i++) if (await fn(arr[i], i, arr)) return true; return false; }
async function everySeq(arr, fn) { for (let i = 0; i < arr.length; i++) if (!(await fn(arr[i], i, arr))) return false; return true; }
async function findSeq(arr, fn) { for (let i = 0; i < arr.length; i++) if (await fn(arr[i], i, arr)) return arr[i]; return undefined; }
async function findIndexSeq(arr, fn) { for (let i = 0; i < arr.length; i++) if (await fn(arr[i], i, arr)) return i; return -1; }
async function flatMapSeq(arr, fn) { return (await mapSeq(arr, fn)).flat(); }
async function reduceSeq(arr, fn, ...init) {
  let i = 0; let acc;
  if (init.length) acc = init[0]; else { if (!arr.length) throw new TypeError("reduce of empty array with no initial value"); acc = arr[0]; i = 1; }
  for (; i < arr.length; i++) acc = await fn(acc, arr[i], i, arr);
  return acc;
}
module.exports = { mapSeq, filterSeq, someSeq, everySeq, findSeq, findIndexSeq, flatMapSeq, reduceSeq };
