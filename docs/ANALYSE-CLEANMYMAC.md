# Analyse REA — cleanmymac.com/fr (base de Boost My Pc v2)

Outil : REA `capture_browser_scenario` (Chrome headless, 1440×900, fr-FR), page publique `https://cleanmymac.com/fr`.
Evidence : `ev_10be91e710c2929f2bea5232c7c48127725044fdad11c66494c0573f44ccdbd5` (capture d'écran + arbre d'accessibilité, aucune action sur la page).

## Fonctionnalités annoncées (observées dans le texte de la page)

| Module annoncé | Ce que la page décrit |
|---|---|
| Entretien intelligent | « exécute cinq actions principales » (fichiers inutiles, fichiers malveillants…) en une analyse |
| Nettoyage | fichiers système inutiles, fichiers cachés, téléchargements endommagés « et 20 autres types » |
| Performances | désactiver les applications d'arrière-plan et celles lancées au démarrage |
| Applications | supprimer des applications et leurs résidus, ne manquer aucune mise à jour |
| Protection | analyse rapide, normale ou approfondie ; confidentialité ; autorisations des applications |
| Nettoyage cloud | voir ce qui occupe le stockage cloud et faire du ménage |
| Encombrement | doublons, images similaires, tri des téléchargements |
| Space Lens / Télescope | cartographie interactive du disque, tri des dossiers par taille, fichiers les plus volumineux |
| (général) | « plus de 25 outils » |

## Identité visuelle (mesurée sur la capture)

| Rôle | Couleur |
|---|---|
| Violet profond (bas du dégradé) | `#7418A9` |
| Magenta (icône) | `#F133C5` |
| Rose vif (texte « Mac ») | `#FB35B5` |
| Rose poudré (milieu) | `#C3699E` |
| Ciel lavande (haut) | `#E2D5E6` |
| Lavande (reflets) | `#A9A3E3` |
| Bouton d'action | vert vif, coins très arrondis |

Style : grand fond en dégradé lavande → rose → violet, barre de navigation flottante blanche très arrondie, boutons « pilule », typographie arrondie et grasse.

## Décisions pour Boost My Pc v2

- **Inspiration, pas copie** : palette violet/magenta, panneaux en verre dépoli (`backdrop-filter`), un dégradé par module, grand bouton d'analyse circulaire. Aucun logo, icône, illustration ni nom de MacPaw n'est repris.
- Chaque module annoncé a un équivalent Linux/Windows (voir le README) ; « Nettoyage cloud » agit sur les dossiers synchronisés localement (OneDrive, Dropbox, Google Drive, Nextcloud…), faute d'accès aux API des services.

## Limites

- Seule la page d'accueil publique a été observée ; l'application macOS elle-même n'a pas été analysée (elle ne fonctionne pas sous Windows/Linux).
- Les couleurs sont échantillonnées sur une capture (compression et dégradés possibles) : ce sont des valeurs approchées.
