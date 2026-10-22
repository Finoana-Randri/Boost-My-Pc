<p align="center">
  <img src="docs/logo.png" alt="FastBoost" width="140">
</p>

<h1 align="center">FastBoost</h1>

<p align="center"><b>Nettoyez, protégez et accélérez votre PC — sous Linux et Windows.</b></p>

FastBoost 2 rassemble plus de 25 outils d'entretien dans une interface en verre dépoli, où chaque module a sa propre couleur. Ses fonctionnalités s'inspirent de **CleanMyMac** (modules analysés avec REA, voir [docs/ANALYSE-CLEANMYMAC.md](docs/ANALYSE-CLEANMYMAC.md)) et de **Microsoft PC Manager** ([docs/ANALYSE-REA.md](docs/ANALYSE-REA.md)). Projet indépendant : aucun logo, icône ni code de ces applications n'est réutilisé.

<p align="center">
  <img src="docs/screenshots/v2/01-entretien-intelligent.png" alt="Entretien intelligent" width="820">
</p>

## Captures d'écran (Linux)

### Entretien intelligent
Une seule analyse vérifie cinq points ; un clic applique les actions sûres.

![Résultats de l'entretien intelligent](docs/screenshots/v2/02-resultats-entretien.png)

| Nettoyage | Protection — menaces |
|---|---|
| ![Nettoyage](docs/screenshots/v2/03-nettoyage.png) | ![Menaces](docs/screenshots/v2/04-protection-menaces.png) |

| Confidentialité | Performances |
|---|---|
| ![Confidentialité](docs/screenshots/v2/05-confidentialite.png) | ![Performances](docs/screenshots/v2/06-performances.png) |

| Restes d'applications | Images similaires |
|---|---|
| ![Restes](docs/screenshots/v2/07-restes-applications.png) | ![Images similaires](docs/screenshots/v2/08-images-similaires.png) |

| Carte du disque | Nettoyage cloud |
|---|---|
| ![Carte du disque](docs/screenshots/v2/09-carte-du-disque.png) | ![Cloud](docs/screenshots/v2/10-nettoyage-cloud.png) |

| Broyeur | Outils | Paramètres |
|---|---|---|
| ![Broyeur](docs/screenshots/v2/11-broyeur.png) | ![Outils](docs/screenshots/v2/12-outils.png) | ![Paramètres](docs/screenshots/v2/13-parametres.png) |

> Captures réalisées sous Debian 12 (Xvfb) avec des données de test ; la barre du bureau et les boutons de fenêtre n'y apparaissent donc pas.

## Modules

| Module | Ce qu'il fait |
|---|---|
| **Entretien intelligent** | Analyse en une fois les fichiers inutiles, les menaces, la maintenance, les mises à jour et les gros fichiers oubliés ; « Exécuter » applique les actions sans risque |
| **Nettoyage** | Caches système et navigateurs, fichiers temporaires, journaux, rapports de plantage, cache des paquets, fichiers de développement (npm, pip, Yarn, Gradle, Cargo), corbeille |
| **Protection** | Analyse rapide, normale ou approfondie (ClamAV + analyse heuristique sous Linux, Microsoft Defender sous Windows) ; confidentialité (historique, cookies, sessions — jamais les mots de passe ni les favoris) ; autorisations des applications (Flatpak sous Linux, caméra/micro/localisation sous Windows) ; état du pare-feu |
| **Performances** | Tâches de maintenance (DNS, polices, TRIM des SSD, journaux, paquets orphelins…), applications au démarrage, gros consommateurs, diagnostic réseau |
| **Applications** | Désinstallation (apt, dnf, pacman, zypper, Flatpak, Snap / Windows et Microsoft Store), restes d'applications supprimées, mises à jour |
| **Encombrement** | Doublons (contenu identique), images similaires (empreinte perceptuelle), gros et anciens fichiers, téléchargements |
| **Carte du disque** | Carte interactive des dossiers : cliquez pour explorer, supprimez ce qui ne sert plus |
| **Nettoyage cloud** | Gros fichiers et fichiers anciens des dossiers OneDrive, Dropbox, Google Drive, Nextcloud…; « Libérer l'espace local » pour OneDrive |
| **Broyeur** | Suppression définitive par écrasement aléatoire (1, 3 ou 7 passes), avec glisser-déposer |
| **Mini-panneau** | Sous Linux, un clic sur l'icône de la barre supérieure ouvre un panneau compact (état, Boost, corbeille, mises à jour) ; `fastboost --mini` pour un raccourci clavier |

Sécurité : rien n'est supprimé sans confirmation, les suppressions passent par la corbeille (sauf le Broyeur, explicite), les dossiers système sont protégés, et sous Linux les actions système demandent le mot de passe via polkit.

## Installation

### Linux

```bash
# Debian / Ubuntu / Mint / Pop!_OS
sudo apt install ./fastboost_2.0.0_amd64.deb

# Toutes les distributions
chmod +x FastBoost-2.0.0.AppImage && ./FastBoost-2.0.0.AppImage
```

Sur GNOME « pur » (Fedora, Debian), installez l'extension *AppIndicator and KStatusNotifierItem Support* pour l'icône de la barre supérieure.

### Depuis les sources

```bash
npm install
npm start
```

### Construire les paquets

```bash
npm run dist:linux   # AppImage + .deb
npm run dist:win     # installateur Windows
```

## Effets visuels

Le verre dépoli et les animations s'adaptent à la machine : sans accélération graphique (machine virtuelle, pilote bloqué), FastBoost passe automatiquement en mode léger. Réglage dans **Paramètres → Effets visuels** (Automatique, Activés, Désactivés). Le thème suit le système (sombre ou clair).

## Tests

```bash
node scripts/test-v2-services.js      # modules v2 (Windows ou Linux)
npm run test:linux                    # services Linux de base
```

Avec Docker : `scripts/docker-test.sh` (Debian 12, Fedora 41, Arch Linux), `scripts/docker-v2.sh` (services v2 et 16 parcours de l'interface sous Xvfb, avec données de test).

## Structure

```
src/main.js                 processus principal, IPC, mode léger
src/menubar.js              icône de la barre supérieure, mini-panneau, alertes
src/services/               Windows (PowerShell), Linux (src/services/linux) et communs
src/services/v2/            modules v2 : entretien intelligent, maintenance, confidentialité,
                            autorisations, restes, menaces, broyeur, carte du disque,
                            images similaires, cloud
src/renderer/               interface (verre dépoli, dégradés par module) + mini-panneau
assets/                     logo (SVG source + PNG)
scripts/                    tests et construction via Docker
docs/                       analyses REA et captures d'écran
```

## Licence

MIT. Projet indépendant, non affilié à Microsoft ni à MacPaw.
