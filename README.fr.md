[English](README.md) · **Français**

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz/)

# Season Card — carte saisons + météo compacte (Lovelace)

> [!NOTE]
> Pourquoi ce n'est pas une carte météo de plus…  
> C'est avant tout un sélecteur unique de **MODE** (pour activer ou désactiver le mode chauffage, climatisation, etc.) — soit [manuel](#a-usage-détaillé--sélecteur-manuel-de-mode), soit [automatique](#b-usage-détaillé--mode-automatique) si vous utilisez l'intégration native **Season** de Home Assistant.

Carte Lovelace pour Home Assistant : **mode sélecteur** (`input_select`) ou **mode capteur** (`sensor.season`), avec **bandeau météo** (température ressentie, icône condition, pluie 24 h, lever/coucher du soleil) et **ambiance** (dégradé + motifs) liée à la température extérieure.

**Dépôt** : [https://github.com/ebozonne/season-card](https://github.com/ebozonne/season-card)

---

## Aperçu

![Fonctionnalités](docs/readme/QuatreSaisons_features.jpg)

- **Température ressentie** — approximation simple (vent et humidité).
- **Fond coloré + motifs** (PNG) — teinte liée à la température ; adaptation **clair / sombre** au thème.
- **Parapluie** — affichage si risque de pluie dans les **24 h** (prévisions horaires HA).
- **Soleil** — heures de lever et de coucher.
- **Mode sélecteur (`input_select`)** — rail pilotable (usage chauffage / automations).
- **Mode capteur (`sensor.season`)** — rail non réglable, piloté par l'état de Home Assistant.

![Thèmes clair et sombre](docs/readme/QuatreSaisons_themes.jpg)

---

## Installation

### Via HACS (recommandé)

[![Ouvrir dans HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=ebozonne&repository=season-card&category=plugin)

1. Cliquez sur le bouton ci-dessus — il ouvre directement votre instance Home Assistant sur la fenêtre HACS, ce dépôt déjà pré-rempli.  
   *(Procédure manuelle de secours : HACS → menu **⋮** → **Dépôts personnalisés** → URL `https://github.com/ebozonne/season-card`, catégorie **Dashboard**.)*
2. Dans HACS, cliquez sur **Télécharger** sur l'entrée **Season Card**.
3. Ajoutez la carte au tableau (`Ajouter une carte` → **Season Card**, ou YAML `type: custom:season-card`).

### Manuelle (sans HACS)

1. Copier **le contenu** du dossier **`dist/`** de ce dépôt vers **`config/www/season-card/`** (à la racine de ce dossier : `season-card.js`, `temperature-colorscale.json`, dossiers `season-icons/`, `meteocons-mono-icons/`, `meteocons-fill-icons/`, `season-motifs/`, etc.).
2. **Paramètres** → **Tableaux de bord** → **Ressources** → **Ajouter une ressource** : URL **`/local/season-card/season-card.js`**, type **JavaScript module**. En cas de cache navigateur tenace, vous pouvez ajouter un paramètre de version dans l'URL (`?v=…`).

---

## Démarrage rapide

La configuration **standard** comporte **trois** lignes YAML : `type`, `entity`, `weather_entity`.

```yaml
type: custom:season-card
entity: input_select.season              # ou sensor.season pour le mode auto
weather_entity: weather.forecast_maison  # optionnel — remplacer par votre weather.*
```

> [!IMPORTANT]
> Le domaine **`weather`** n'est pas un « paquet à installer » pour la carte : c'est le type d'entité que vous pointez dans **`weather_entity`**.

Variantes minimales courantes :

```yaml
# Slider seul (sans bandeau météo)
type: custom:season-card
entity: input_select.season
```

```yaml
# Bandeau météo seul (sans slider)
type: custom:season-card
weather_entity: weather.forecast_maison
```

```yaml
# Mode auto seul (rail piloté par capteur)
type: custom:season-card
entity: sensor.season
```

Si votre `entity` n'existe pas encore, allez à la section correspondante : [(A) sélecteur manuel](#a-usage-détaillé--sélecteur-manuel-de-mode) ou [(B) mode automatique](#b-usage-détaillé--mode-automatique).

---

## (A) USAGE détaillé — sélecteur manuel de MODE

> [!IMPORTANT]
> Prérequis : helper **`input_select`** avec **exactement les options** que vous utiliserez partout (automations, scripts, etc.)

> [!TIP]
> Exemple : `input_select.season` — nom d'entité **`season`**, nom affiché **SEASON**, icône **`mdi:sun-snowflake-variant`** :

```yaml
input_select:
  season:
    name: SEASON
    icon: mdi:sun-snowflake-variant
    options:
      - "❄️ WINTER"
      - "🍂 MID-SEASON"
      - "☀️ SUMMER"
```

La carte affiche les **libellés tels qu'ils sont définis** dans le helper (ordre YAML = positions gauche → droite sur le rail). Les couleurs du rail s'appuient sur des mots-clés dans le texte de l'option (par ex. `WINTER`, `MID` / mi-saison, `SUMMER` / été). La météo est optionnelle.

```yaml
type: custom:season-card
entity: input_select.season
weather_entity: weather.forecast_maison   # [OPTION] remplacer par votre weather.*
```

- **`type`** et **`entity`** : requis côté Lovelace / carte (`entity` = votre `input_select`).
- **`weather_entity`** : en option vous choisissez **quelle** entité `weather.*` alimente le bandeau ; l'exemple ci-dessus n'est qu'une valeur d'instance. Sans elle, le bandeau météo reste masqué.
- **Lever / coucher** : par défaut **`sun.sun`** (attributs `next_rising` / `next_setting`, affichés dans le **fuseau horaire de Home Assistant**). Pour une autre entité, la carte affiche son **`state`** ; surcharge possible avec `weather_sunrise_entity` et `weather_sunset_entity`.

---

## (B) USAGE détaillé — MODE automatique

> [!IMPORTANT]
> Prérequis : avoir déjà une entité active pour sélectionner la saison ou le mode. Soit l'intégration par défaut **Season** de Home Assistant (Paramètres → Appareils et Services → Ajouter une intégration), soit votre propre helper `input_select` que vous utilisez habituellement pour activer ou désactiver votre chauffage, climatisation ou autre.

Comportement de ce mode :
- rail **non interactif** (le curseur suit l'état du capteur).

Si c'est l'intégration **Season** de Home Assistant qui est utilisée comme dans l'exemple ci-après, alors :
- 4 positions fixes : `winter` (gauche), `spring`, `summer`, `autumn` (droite),
- couleur du rail basée sur la saison : `winter` et `summer` colorées, `spring` / `autumn` grisées,
- libellé actif localisé avec emoji (ex. ❄️ / 🍃 / ☀️ / 🍂).

La carte affiche les **libellés tels qu'ils sont définis** dans le helper (ordre YAML = positions gauche → droite sur le rail).

```yaml
type: custom:season-card
entity: sensor.season
weather_entity: weather.forecast_maison   # [OPTION] remplacer par votre weather.*
```

Après modification du YAML : vérifier la configuration Home Assistant, puis recharger les **entités d'entrée** (ou redémarrer si votre mode d'édition l'exige).

---

## Choisir un pack d'icônes météo

La carte est livrée avec **trois packs** d'icônes condition (mêmes 15 conditions, même rendu). Réglage via la clé **`weather_icon_set`** :


| Valeur                  | Style                                                            | Couleur                                              |
| ----------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `season` *(par défaut)* | Animations maison, monochromes                                   | Pilotée par `weather_color` (suit le thème)          |
| `meteocons-mono`        | [Meteocons](https://meteocons.com/) monochromes animées          | Pilotée par `weather_color` (suit le thème)          |
| `meteocons-fill`        | [Meteocons](https://meteocons.com/icons/?style=fill) en couleurs | Couleurs gradient d'origine (indépendantes du thème) |


```yaml
type: custom:season-card
entity: input_select.season
weather_entity: weather.forecast_maison
weather_icon_set: meteocons-fill   # ou: season | meteocons-mono
```

> Si `weather_icon_set` n'est pas précisé, le pack `season` est utilisé.

---

## Options démo (hors usage courant)

À utiliser **ponctuellement** pour tester l'UI, puis retirer ou remettre aux valeurs par défaut.


| Paramètre                     | Défaut     | Exemple  | Rôle                                                                                                                            |
| ----------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `external_temp`               | *(absent)* | `32`     | Force une température **°C** (motifs, ambiance, ressenti, **T** affichée) sans modifier la météo réelle.                        |
| `weather_rain_umbrella_force` | `false`    | `true`   | Affiche le bloc **☂️** comme s'il y avait une alerte, **sans** appeler les prévisions.                                          |
| `season_force`                | *(absent)* | `autumn` | **Mode `sensor.season` uniquement** : force l'affichage d'une saison (`winter`, `spring`, `summer`, `autumn`) pour test visuel. |


---

## Licence

Voir le fichier [`LICENSE`](LICENSE) (MIT).
