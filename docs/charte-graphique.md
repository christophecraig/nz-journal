# Charte graphique — Carnet de bord NZ

Référence unique pour toute modification d'apparence du site (public et admin).
Établie le 23 nov. 2026 avec Christophe, à partir d'un recueil des besoins (maquettes comparées, choix validés un par un).

**À lire avant de toucher au CSS, aux polices, aux couleurs ou au balisage visuel.**
Si une décision ici est modifiée, mettre ce fichier à jour dans le même commit.

## 1. Principes non négociables

- Le logo (`public/logo.svg`) est validé et ne change pas. Il fixe la palette.
- Changer l'apparence ne change jamais les fonctionnalités ni les comportements : le site marche bien, on ne touche ni à la logique JS, ni à l'API, ni aux parcours.
- Direction : « Terrain et carte » (esprit planche topographique), ambiance fraîche et dynamique.
- Les photos sont les vedettes ; le texte du récit reste confortable à lire.
- Coins droits partout (`border-radius: 0`), sauf le calendrier (voir §6) et filets au lieu d'ombres. Pas de dégradé décoratif, pas d'ombre portée, pas de rotation « polaroid ».
- Mobile d'abord : Christophe consulte et publie depuis son téléphone.

## 2. Couleurs (mode clair)

| Rôle | Valeur | Usage |
|---|---|---|
| Vert profond | `#12403A` | Titres, filets, texte d'interface, case de jour écrit, fonds forts |
| Crème | `#F6F0E3` | Fond de page, texte sur vert profond |
| Ambre | `#F2B544` | Point d'attention, soulignement actif, accent sur fond vert profond |
| Terre | `#B5651D` | Métadonnées (dates, distances), kicker, liens secondaires |

Valeurs de travail issues des maquettes, non discutées une à une, à ajuster si le rendu réel l'exige :
texte courant `#2B2B26`, texte discret `#5B5A50`, surface de carte plus claire `#FFFBF2`.

Contrastes à respecter : texte sur crème en vert profond ou `#2B2B26` ; l'ambre ne sert jamais de couleur de texte sur fond crème (contraste insuffisant), seulement sur vert profond ou en aplat.

## 3. Mode sombre (automatique, `prefers-color-scheme: dark`)

Palette « nuit » dérivée du logo, valeurs issues des maquettes :

| Rôle | Valeur |
|---|---|
| Fond | `#0C1F1C` |
| Texte et filets | `#F6F0E3` |
| Ambre | `#F2B544` |
| Vert d'appoint | `#3FB59A` |

Le mode sombre se pilote par variables CSS (voir §8), sans JS ni bouton de bascule.

## 4. Typographie

Deux familles seulement.

| Famille | Usage |
|---|---|
| **Space Mono** (400, 700) | Interface (onglets, boutons, étiquettes), données (dates, distances, altitudes, coordonnées), **titres** (en 700), légendes photo |
| **Source Serif 4** (400, italique 400) | **Récit du jour** (corps de texte), commentaires |

- Étiquettes et onglets en MAJUSCULES, petite taille (11–12 px), Space Mono.
- Titres en Space Mono 700, casse normale, interlignage serré (~1,2).
- Récit : Source Serif 4, 15–17 px, interlignage ~1,6.
- Remplace l'existant : variables `--serif` (Iowan/Palatino/Georgia) et `--sans` (system-ui) à supprimer.
- Polices **hébergées avec le site** dans `public/fonts/` (sous-ensemble latin, licence OFL jointe), déclarées par `@font-face` avec `font-display: swap`, repli `ui-monospace` / `Georgia`. Aucun appel à Google Fonts.

## 5. Formes et filets

- Aucun arrondi (`border-radius: 0`), y compris boutons, champs, cartes, pastilles, onglets. Exceptions : pastilles-repères de la carte (cercles), si elles restent circulaires.
- Filets pleins vert profond : 1 px pour les séparations, 1,5 px pour les contours de composants (cartes, étiquettes, boutons).
- Pas d'ombre portée. Le relief vient des filets et des aplats.

## 6. Composants

- **En-tête** : logo à gauche (inchangé), kicker « CARNET DE BORD » en Space Mono (+ repère de coordonnées optionnel), titre « Nouvelle-Zélande » en Space Mono 700. Un filet vert profond en dessous.
- **Navigation par onglets** (Calendrier / Carte / Photos) : Space Mono, majuscules, onglet actif en gras avec soulignement ambre de 2 px ; séparée du contenu par un filet.
- **Calendrier** (exception assumée aux coins droits, jugé trop anguleux et agressif le 23 nov.) : cases séparées par 5 px, coins légèrement arrondis (8 px, 6 px sur mobile), bordure fine 1 px très douce (`--filet-doux`, filet à 22 %), sans contour épais. Jour écrit = **case pleine vert profond**, numéro en crème. Jours sans entrée : fond crème, numéro vert profond. Marquages : **aujourd'hui** = numéro sur aplat ambre ; **nouveau commentaire / nouveauté** = point ambre dans la case ; **jour à écrire** (admin) = contour pointillé terre, fond surface ; **brouillon** = contour pointillé.
- **Erreurs** : rouge bordeaux `#7A1F2B` (clair), `#E58A96` (sombre, dérivé). Jamais l'ambre ni la terre pour une erreur.
- **Étiquette de section** (Repas, Bar, Activité) : texte Space Mono majuscules 11 px dans un cadre 1,5 px vert profond, fond transparent.
- **Données d'une journée** : ligne Space Mono en terre, séparateur « · » (ex. `J12 · 08.12 · 1 967 m · 19,4 km`).
- **Boutons** : coins droits, contour 1,5 px vert profond, Space Mono ; bouton principal = fond vert profond + texte crème ; survol = contour terre (pas de déplacement), focus clavier = contour ambre 2 px.
- **Photos, mobile** : pleine largeur, sans bord, légende en Space Mono dessous (ex. `IMG_0412 · 08.12 · 06:42 · Tongariro`). À confirmer par Christophe : dérivé de « pas de mosaïque sur mobile, trop petit ».
- **Photos, ordinateur** : mosaïque serrée, quasi sans marge (2 px), coins droits ; la légende s'affiche en bandeau au survol. C'est le choix explicite de Christophe.
- **Visionneuse plein écran** : fond sombre conservé, boutons à coins droits.

## 7. Ton visuel

Frais, dynamique, précis : un carnet de terrain plutôt qu'un album. Peu d'ornements, des données bien alignées, des photos grandes. Éviter le côté « scrapbook » (polaroids inclinés, ombres, textures papier).

## 8. Mise en œuvre technique

- Tout passe par des variables CSS en tête de `public/style.css` (`:root`, puis un bloc `@media (prefers-color-scheme: dark)` qui ne redéfinit que ces variables). Aucune couleur ni police en dur ailleurs dans le fichier.
- Variables en place : `--fond`, `--surface`, `--texte`, `--discret`, `--titre`, `--filet`, `--plein` / `--sur-plein` (aplats forts), `--ambre` / `--sur-ambre`, `--terre`, `--erreur`, `--mono`, `--serif`. En mode sombre, `--titre` et `--filet` deviennent crème et `--plein` devient le vert d'appoint `#3FB59A`.
- Couleurs de tracés de la carte (JS, `app.js` et `dayview.js`) : `#12403A` et `#B5651D`, à garder alignées.
- `theme-color` (`index.html`, `admin.html`) et `theme_color` du manifest valent `#12403A`.
- Tests : `npm test` doit rester vert ; une refonte visuelle ne doit modifier aucun test de comportement.
- Ne pas casser les sélecteurs utilisés par le JS (classes `.cell`, `.has`, `.today`, `.todo`, etc.) : changer leur apparence, pas leur nom.

## 9. État de l'existant (avant refonte)

À remplacer : fond `#f6f1e7`, vert « fern » `#2f6f55`, argile `#c5603a`, polices Iowan/Palatino/Georgia + system-ui, arrondis 8–16 px, onglets en pilule, galerie « polaroid » inclinée avec ombre, pastilles rondes de statistiques, bordure gauche argile sur les courses.
À conserver : logo, structure et comportement de tous les écrans, tuiles OpenStreetMap de la carte.

## 10. Questions ouvertes (non traitées dans le recueil)

- Image de partage `og-image.png` et icônes PWA : à régénérer si leurs couleurs diffèrent de la palette.
- Style des tuiles de carte : inchangé pour l'instant.
- Polices au format WOFF (zlib) faute d'outil WOFF2 : à convertir en WOFF2 pour gagner environ 30 % de poids si un outil devient disponible.
- Appliqué le 23 nov. 2026 mais jamais vu à l'écran avant mise en ligne : relire le rendu réel (mobile et ordinateur) et ajuster.
