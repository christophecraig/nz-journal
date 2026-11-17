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
   notes vocales (enregistrement direct ou import), vidéos (lien), lieux (bouton « Ma position » ou coordonnées).
4. Enregistrer. Les visiteurs voient le jour immédiatement.

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
