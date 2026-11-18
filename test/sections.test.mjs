import test from "node:test";
import assert from "node:assert/strict";
import { insertSection, SECTIONS } from "../public/js/sections.js";

test("texte vide : le titre est posé tel quel, curseur dessous", () => {
  const r = insertSection("", undefined, "🍽 Repas");
  assert.equal(r.text, "## 🍽 Repas\n\n");
  assert.equal(r.cursor, r.text.length);
});

test("à la fin d'un texte : une ligne vide est ajoutée selon les retours à la ligne déjà là", () => {
  assert.equal(insertSection("Salut", undefined, "T").text, "Salut\n\n## T\n\n");
  assert.equal(insertSection("Salut\n", undefined, "T").text, "Salut\n\n## T\n\n");
  assert.equal(insertSection("Salut\n\n", undefined, "T").text, "Salut\n\n## T\n\n");
});

test("au milieu : le texte qui suit reste après le titre, curseur sous le titre", () => {
  const r = insertSection("AB", 1, "T");
  assert.equal(r.text, "A\n\n## T\n\nB");
  assert.equal(r.text.slice(r.cursor), "B");
});

test("position hors limites ramenée dans le texte ; puces définies", () => {
  assert.equal(insertSection("ab", 99, "T").text, "ab\n\n## T\n\n");
  assert.equal(insertSection("ab", -5, "T").text, "## T\n\nab");
  assert.deepEqual(SECTIONS.map((s) => s.id), ["repas", "bar", "activite"]);
});
