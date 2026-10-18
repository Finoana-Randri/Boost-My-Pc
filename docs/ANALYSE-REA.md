# Analyse REA — Microsoft PC Manager 3.23.0.0

Cible : `C:\Program Files\WindowsApps\Microsoft.MicrosoftPCManager_3.23.0.0_x64__8wekyb3d8bbwe\PCManager`
Outil : `rea-agents@6.5.0 inspect-managed-members` (analyse statique des métadonnées PE/CLI, aucun code cible exécuté).

> Le serveur MCP REA n'a pas réussi à se connecter (timeout) ; l'analyse a été faite via la CLI REA, qui produit les mêmes Evidence.

## Architecture observée

- Application **WPF / .NET 8** (`PresentationFramework.dll`, `coreclr.dll`, `System.Windows.Forms.dll`), WebView2 (`Microsoft.Web.WebView2.Core.dll`) et une grosse ressource web (`Microsoft.WIC.PCManager.WebResource.dll`, 18 Mo).
- Processus séparés : `MSPCManager.exe` (UI), `MSPCManagerCore.exe`, `MSPCManagerService.exe` (service élevé), `MSPCManagerWidget.exe`, `PCMAutoRun.exe`.
- L'UI parle au service via un **RPC local** (`Microsoft.WIC.PCManager.LocalRpc*.dll`) — chaînes du type `[PCBMemCleanAsync] RPC call failed`.
- Architecture **par plugins** (`Microsoft.WIC.PCManager.Plugin.*.dll`, chaque plugin a un `*PluginBootstrapper`).

## Plugins et fonctionnalités (observations → Evidence)

| Plugin | Ce que REA montre | Evidence |
|---|---|---|
| PCBoost | `BoostOptionsService`, `ProcessUtils`, `StartupScanService`, requêtes WMI `Win32_Process`, clés `Run` / `StartupApproved\Run`, `Memory_StartPercent/EndPercent`, `NetworkTrafficPlugin` (débit réseau) | `ev_bcbf0074…` |
| CleanTrash.Options | Scènes `SmartClean`, `HealthCheck` (Windows Cache, Web Trash, Temp Files, System Trash, System Log, Recent Files), `DeepClean` (Temporary Setup Files, DirectX Shader Cache, Delivery Optimization, Device driver packages, Internet cache, Old ChkDsk, Setup logs, Memory dumps, Thumbnails, Windows upgrade leftovers…) | `ev_d8b0de32…` |
| DiskAnalysis | Analyseurs `LargeFile`, `DownloadedFile`, `DuplicateFile`, `RecycleBin`, vue d'ensemble disque, types de fichiers par extension | `ev_0d1a4095…` |
| FileManagement | Recherche des téléchargements via l'historique SQLite d'Edge/Chrome/Firefox, `LargeFilesFinder`, `DuplicateFilesFinder`, déplacement/suppression, `explorer.exe /select,` | `ev_abde8ba3…` |
| Uninstall | Liste depuis `SOFTWARE\…\Uninstall` (+ Wow6432Node) et Store, `UninstallString`/`QuietUninstallString`, `EstimatedSize`, `InstallDate`, nettoyage des résidus | `ev_184820b2…` |
| NetworkProblem | Scan items : Connection, DHCP, DNS, variables d'environnement proxy, WebProxy (`ProxyEnable`), Hardware ; hôtes test `www.microsoft.com`, `www.bing.com` | `ev_e4a032cd…` |
| SystemUpdate | COM `Microsoft.Update.Session` (`IUpdateSearcher`, `IUpdateDownloader`, `IUpdateInstaller`), `shutdown -r -t 5` | `ev_3295d324…` |
| ToolBoxTools | Calculatrice, Calendrier, Sous-titres (`LiveCaptions.exe`), Convertisseur de devises, Dictionnaire, Liens rapides Edge (`Top Sites`), Recherche d'image, Bloc-notes, Enregistreur, Capture d'écran, OCR, Traducteur, Météo | `ev_6c86f3fd…` |
| PCWndManager / ADBlock | Blocage de pop-ups par hooks `SetWinEventHook` / `WH_MOUSE_LL`, réparation de la barre des tâches | `ev_e730d7a0…`, `ev_93fb5276…` |

## Inférences / décisions de reconstruction

- Le "Boost" combine **libération mémoire** (vidage des working sets) et **nettoyage des fichiers temporaires** → reproduit.
- Le "Bilan de santé" = scène `HealthCheck` → reproduit avec les mêmes catégories.
- Le "Nettoyage approfondi" = scène `DeepClean` → reproduit (les catégories qui exigent les droits admin sont signalées).
- Le service élevé + RPC est remplacé par le processus principal Electron qui appelle PowerShell / Node.

## Non reproduit (inconnu ou hors périmètre)

- Blocage de pop-ups (hooks globaux natifs), anti-hack, widget, télémétrie, comptes MSAL.
- Les règles de nettoyage chiffrées (`decrypted data is null`) ne sont pas lisibles statiquement : la liste de chemins est reconstruite d'après les noms de catégories et les emplacements Windows connus.
- Le contenu de l'UI web (WebResource.dll) n'a pas été décompilé ; l'interface est une recréation du style Fluent de PC Manager.
