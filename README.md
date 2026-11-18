# Carnet de bord – Nouvelle-Zélande

Site statique + une fonction Netlify (`netlify/functions/api.mjs`) qui stocke tout dans **Netlify Blobs**
(textes, photos, notes vocales). Aucune base de données à configurer.

- `/` : calendrier public, carte globale, fiche de chaque jour (`/#2026-11-18` = lien direct vers un jour)
- `/admin` : connexion par mot de passe, puis écriture/modification des jours

## Déploiement (une fois)

Netlify « glisser-déposer » ne gère pas les fonctions : il faut passer par Git ou la CLI.

### Option A – CLI (le plus rapide)
```bash
npm i -g netlify-cli
cd carnet-nz
netlify login
netlify init            # crée le site (ou: netlify link si déjà créé)
netlify env:set ADMIN_PASSWORD "ton-mot-de-passe-long"
netlify deploy --build --prod
```

### Option B – GitHub
1. Pousse ce dossier dans un dépôt GitHub.
2. Netlify → *Add new site* → *Import from Git* (aucune commande de build, publish = `public`, déjà dans `netlify.toml`).
3. *Site configuration → Environment variables* : ajoute `ADMIN_PASSWORD` (et, facultatif, `SESSION_SECRET`).
4. Redéploie après avoir ajouté la variable.

## Utilisation au quotidien
1. Ouvre `https://ton-site.netlify.app/admin`, connecte-toi (la session dure 30 jours sur l'appareil).
2. « ＋ Aujourd'hui » ou touche un jour du calendrier.
3. Titre, récit (Markdown léger), photos (redimensionnées et débarrassées de leurs métadonnées EXIF/GPS dans le navigateur),
   notes vocales (enregistrement direct ou import), vidéos (lien), étapes du jour (voir ci-dessous).
4. Enregistrer. Les visiteurs voient le jour immédiatement.

## Étapes et itinéraire
- Un jour peut avoir plusieurs **étapes** (nom, heure, note), dans l'ordre du trajet (↑ ↓ pour réordonner).
- **Placer une étape** : champ « Chercher un lieu » (suggestions dès 3 lettres, classées par proximité de l'étape précédente),
  « Ma position » (le nom est deviné), « Choisir sur la carte » (un appui pose le point), ou coordonnées dans « Saisie avancée ».
  La recherche passe par le serveur (route `/api/geocode`, réservée à l'admin, avec cache) : Photon de Komoot (`photon.komoot.io`,
  API publique sans garantie), et en secours, sur demande (bouton), Nominatim d'OpenStreetMap (1 requête/s, pas de recherche pendant la frappe,
  conformément à leurs règles). Les résultats dépendent des données OpenStreetMap. Variables optionnelles : `PHOTON_URL`, `NOMINATIM_URL`.
- **Itinéraire en voiture** : calculé une seule fois à l'enregistrement par le serveur OSRM public (`router.project-osrm.org`,
  service de démonstration sans garantie, usage léger uniquement), puis stocké dans la fiche du jour : les visiteurs ne déclenchent aucun appel.
  S'il est indisponible, la carte affiche des lignes droites en pointillés ; il suffit de ré-enregistrer le jour plus tard.
  Variable optionnelle `OSRM_URL` pour pointer vers un autre serveur compatible OSRM (ex. un OpenRouteService/OSRM auto-hébergé).
  La case « Tracer l'itinéraire en voiture » se décoche pour les jours sans trajet.
- Chaque photo peut être rattachée à une étape (menu sous la photo) ; elle s'affiche alors sous cette étape. Aucun blob supplémentaire.
- **Position approximative** (case à cocher par étape) : coordonnées arrondies à ~1 km **avant** stockage, le point précis n'est jamais enregistré.
- Les fiches enregistrées avant cette fonctionnalité restent valides : leurs « lieux » deviennent la première étape.

## Commentaires et statistiques
Inactifs tant que `public/js/config.js` est vide : le site reste identique.
- **Commentaires (Supabase)** : lecture libre ; pour commenter, connexion Google ou e-mail + mot de passe **sans aucun e-mail envoyé**
  (pas de « mot de passe oublié » tant qu'aucun envoi d'e-mail n'est configuré). Les commentaires vivent dans Supabase, pas dans Netlify.
  1. Créer le projet Supabase, coller `supabase/schema.sql` dans *SQL Editor*, puis dans *Authentication* : activer Google, désactiver *Confirm email*,
     ajouter l'adresse du site dans *URL Configuration* (Site URL + Redirect URLs `https://ton-site/**`).
  2. Renseigner `supabaseUrl` et `supabaseAnonKey` dans `public/js/config.js` (valeurs publiques).
  3. Pour que l'admin puisse supprimer n'importe quel commentaire : variables Netlify `SUPABASE_URL` et `SUPABASE_SERVICE_KEY` (clé secrète, jamais dans le dépôt).
  Garde-fous en base : 1 commentaire / 10 s et 30 / jour par personne, 1000 caractères max, chacun ne supprime que les siens.
- **Statistiques (GoatCounter, sans cookie)** : renseigner `goatcounter` (le code du compte) dans `public/js/config.js`. Chaque jour consulté est compté
  (`/jour/AAAA-MM-JJ`) ; ni `/admin` ni toi une fois connecté en admin ne sont comptés.

## Courses Coros (automatique)

Les courses à pied et trails (types Coros : course extérieure, tapis, trail, piste) remontent toutes seules :
une fonction planifiée (`netlify/functions/coros-sync.mjs`, toutes les 30 min) lit ton compte Coros via son serveur MCP
(OAuth 2.0), range les courses dans Netlify Blobs et le site les affiche (distance, durée, allure, D+, FC, tracé GPS).
Ça tourne sans aucune visite du site. Les autres sports sont ignorés.

**Connexion (une seule fois)** : sur `/admin`, touche « Connecter Coros », connecte-toi chez Coros et autorise.
La ligne de statut en haut de l'admin indique ensuite la dernière synchro (et la dernière erreur éventuelle).
Le bouton « Synchroniser » force une synchro immédiate.

Variables d'environnement facultatives :
- `COROS_REGION` : `eu` (défaut), `us` ou `cn` selon la région de ton compte Coros ;
- `COROS_SYNC_FROM` : date plancher `AAAA-MM-JJ` (défaut `2026-11-15`, arrivée en Nouvelle-Zélande) ; les courses plus anciennes sont ignorées.

Notes : Netlify n'exécute les fonctions planifiées que sur le déploiement de production. Chaque synchro traite au plus
3 nouvelles courses (limite de durée des fonctions) ; le reste suit à l'exécution suivante. Si Coros change le format de ses
réponses, la synchro s'arrête avec une erreur visible dans la ligne de statut sans casser le site.

## Tests
```bash
npm test      # node --test : décodeur FIT, client OAuth/MCP Coros (faux serveur), API
```

## Limites à connaître
- Chaque fichier envoyé fait **5 Mo max** (limite de 6 Mo par requête des fonctions Netlify). Les photos sont réduites
  à 1600 px (~300–600 Ko), donc sans souci. Les vidéos ne sont **pas hébergées** : colle un lien YouTube/Vimeo
  (non répertorié) ou un .mp4 hébergé ailleurs.
- La carte utilise Leaflet (unpkg) et les tuiles OpenStreetMap : prévu pour un petit trafic.
- Les données vivent dans Netlify Blobs, partagées entre tous les déploiements du site : un redéploiement ne les efface pas.
  Une sauvegarde manuelle n'est pas prévue ; pense à garder les photos originales sur ton téléphone.
- `ADMIN_PASSWORD` sert aussi à signer les sessions ; changer la valeur déconnecte tous les appareils.

## Développement local
```bash
npm i && netlify dev     # sert le site + la fonction + des Blobs locaux sur http://localhost:8888
```
