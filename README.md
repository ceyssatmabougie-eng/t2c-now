# T2C Now

Application PWA pour consulter les prochains passages aux arrêts T2C.

## Prérequis

- Node.js >= 18.0.0
- pnpm >= 8.0.0

## Installation

```bash
pnpm install
```

## Développement

### Lancer web + API ensemble

```bash
pnpm dev
```

### Lancer uniquement l'application web

```bash
pnpm dev:web
```

### Lancer uniquement l'API

```bash
pnpm dev:api
```

## URLs de développement

| Service | URL |
|---------|-----|
| Web (PWA) | http://localhost:5173 |
| API | http://localhost:3001 |
| Health check | http://localhost:3001/health |
| Stops near | http://localhost:3001/stops/near?lat=45.78&lon=3.08 |
| Stops search | http://localhost:3001/stops/search?q=jaude |

## API Endpoints

### GET /health

Vérification de l'état de l'API.

**Réponse :**
```json
{ "ok": true, "name": "t2c-now-api" }
```

### GET /stops/near

Retourne les arrêts proches d'une position géographique.

**Paramètres query :**
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| lat | number | oui | Latitude (-90 à 90) |
| lon | number | oui | Longitude (-180 à 180) |
| radius | number | non | Rayon en mètres (défaut: 800) |

**Exemple :**
```
GET /stops/near?lat=45.7833&lon=3.0833&radius=500
```

**Réponse :**
```json
[
  { "id": "STOP_001", "name": "Jaude", "distance": 120 },
  { "id": "STOP_002", "name": "Delille Montlosier", "distance": 340 }
]
```

**Erreurs :**
- `400` : Paramètres manquants ou invalides
- `500` : Base GTFS manquante

### GET /stops/search

Recherche d'arrêts par nom.

**Paramètres query :**
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| q | string | oui | Terme de recherche (min 2 caractères) |
| limit | number | non | Nombre de résultats (défaut: 10, max: 20) |

**Exemple :**
```bash
curl "http://localhost:3001/stops/search?q=jaude&limit=5"
```

**Réponse :**
```json
[
  { "id": "JAUD", "name": "Clermont-Ferrand Jaude" },
  { "id": "JAUDA", "name": "Jaude" },
  { "id": "JAUDR", "name": "Jaude" }
]
```

**Erreurs :**
- `400` : Paramètre q manquant ou trop court
- `500` : Base GTFS manquante

### GET /stops/:stopId/directions

Retourne les directions (terminus) disponibles pour un arrêt.

**Paramètres path :**
| Paramètre | Type | Description |
|-----------|------|-------------|
| stopId | string | Identifiant de l'arrêt |

**Exemple :**
```bash
curl http://localhost:3001/stops/STOP_001/directions
```

**Réponse :**
```json
[
  { "id": "DIR_A1", "headsign": "LA PARDIEU GARE", "line": "A" },
  { "id": "DIR_A2", "headsign": "LES VERGNES", "line": "A" },
  { "id": "DIR_B1", "headsign": "ROYAT THERMAL", "line": "B" },
  { "id": "DIR_B2", "headsign": "ST-JACQUES LOUCHEUR", "line": "B" }
]
```

**Erreurs :**
- `404` : Arrêt non trouvé

### GET /stops/:stopId/next

Retourne les prochains départs pour un arrêt et une direction.

**Paramètres path :**
| Paramètre | Type | Description |
|-----------|------|-------------|
| stopId | string | Identifiant de l'arrêt |

**Paramètres query :**
| Paramètre | Type | Requis | Description |
|-----------|------|--------|-------------|
| directionId | string | oui | Identifiant de la direction |
| limit | number | non | Nombre de départs (défaut: 3, max: 10) |

**Exemple :**
```bash
curl "http://localhost:3001/stops/STOP_001/next?directionId=DIR_A1&limit=3"
```

**Réponse :**
```json
{
  "stopId": "STOP_001",
  "directionId": "DIR_A1",
  "departures": [
    { "minutes": 3, "time": "20:14", "realtime": false },
    { "minutes": 11, "time": "20:22", "realtime": false },
    { "minutes": 19, "time": "20:30", "realtime": false }
  ]
}
```

**Erreurs :**
- `400` : Paramètre directionId manquant
- `404` : Arrêt ou direction non trouvé

## Données GTFS

### Emplacement des fichiers

Les fichiers GTFS doivent être placés dans le dossier `data/gtfs/` :

```
data/gtfs/
├── stops.txt          # Obligatoire
├── routes.txt         # Obligatoire
├── trips.txt          # Obligatoire
├── stop_times.txt     # Obligatoire
├── calendar.txt       # Optionnel
└── calendar_dates.txt # Optionnel
```

### Import GTFS

Pour importer les données GTFS dans SQLite :

```bash
pnpm import:gtfs
```

Cette commande :
1. Vérifie la présence des fichiers GTFS obligatoires
2. Supprime l'ancienne base de données si elle existe
3. Crée une nouvelle base `data/gtfs.sqlite`
4. Importe les données avec transactions et prepared statements
5. Crée les index pour optimiser les requêtes

**Résultat :** `data/gtfs.sqlite`

## Structure du projet

```
t2c-now/
├── apps/
│   ├── web/          # Application PWA (Vite + React + TypeScript)
│   └── api/          # API Node.js (Express + TypeScript)
├── data/
│   ├── gtfs/         # Fichiers GTFS source (.txt)
│   └── gtfs.sqlite   # Base de données SQLite (générée)
└── package.json      # Configuration monorepo
```

## Scripts disponibles

| Script | Description |
|--------|-------------|
| `pnpm dev` | Lance web + API en parallèle |
| `pnpm dev:web` | Lance le serveur de développement web |
| `pnpm dev:api` | Lance le serveur API |
| `pnpm import:gtfs` | Importe les données GTFS dans SQLite |
