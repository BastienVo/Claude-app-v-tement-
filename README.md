# 👕 Ma Garde-robe

Application web (installable sur le téléphone) pour :

- **Garde-robe** : prendre chaque vêtement en photo. **Le décor est retiré automatiquement** et l'image est recadrée sur le vêtement (le traitement se fait dans le navigateur, rien n'est envoyé). Classement par catégorie, couleur, marque et saison, avec une recherche.
- **Tenues** : composer ses looks (Quotidien, Travail, Week-end, Soirée, Sport) et recevoir une **tenue du jour** adaptée à la saison. Les pièces peu portées sont proposées plus souvent. « Je la porte » enregistre ce qui a été porté.
- **Achats potentiels** :
  - **Mes envies** : la liste des articles repérés (prix, lien, photo), avec le total. « Acheté ✓ » permet d'ajouter l'article directement à la garde-robe.
  - **Rechercher** : Claude cherche de vrais articles sur le web en tenant compte de ta garde-robe (il faut une clé API Anthropic, à saisir dans les réglages).
  - **Suggestions** : une sélection préparée par Claude dans `data/suggestions.json`.

## Utilisation

Aucune installation ni compilation : ce sont des fichiers statiques.

**Le plus simple : GitHub Pages**
1. Fusionne cette branche dans `main`.
2. Sur GitHub : *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`*.
3. Ouvre l'adresse donnée (`https://<toi>.github.io/<repo>/`) sur ton téléphone, puis *Partager → Sur l'écran d'accueil* (iPhone) ou *Installer l'application* (Android).

**En local** : `python3 -m http.server 8000` puis http://localhost:8000.

## Tes données

Tout est stocké **sur ton appareil** (IndexedDB) : photos, tenues et envies. Pense à faire une sauvegarde de temps en temps avec *Réglages → Exporter* (un fichier JSON, photos comprises), qu'on peut réimporter sur un autre appareil.

## Recherche avec Claude

Deux façons :
1. **Dans l'appli** : mets ta clé API (console.anthropic.com) dans les réglages. Elle n'est stockée que sur ton appareil, et les requêtes partent directement vers Anthropic.
2. **En me parlant** : *Réglages → Copier mon inventaire pour Claude*, colle le texte dans une conversation avec moi et dis-moi ce que tu cherches. Je mets à jour `data/suggestions.json` et la sélection apparaît dans l'onglet *Suggestions*.

Format d'un article dans `data/suggestions.json` :
```json
{ "name": "…", "brand": "…", "price": 49.9, "category": "haut|pull|veste|bas|short|robe|chaussures|accessoire|sport|autre",
  "url": "https://…", "imageUrl": "https://…", "why": "Pourquoi ça te va" }
```

## Structure

```
index.html            page unique
css/style.css         styles (clair/sombre)
js/app.js             interface : garde-robe, tenues, achats, réglages
js/db.js              stockage local + export/import
js/image.js           détourage (@imgly/background-removal) + recadrage
js/claude.js          recherche web via l'API Claude
data/suggestions.json sélection préparée par Claude
sw.js                 fonctionnement hors connexion
```
