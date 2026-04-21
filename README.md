![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)

# Season Card — carte 4 saisons + météo compacte (Lovelace)

Carte Lovelace pour Home Assistant : **curseur de saison** (`input_select`) + **bandeau météo** (température ressentie, icône condition, pluie 24 h, lever/coucher du soleil), avec **ambiance** (dégradé + motifs) liée à la température extérieure.

**Dépôt** : [https://github.com/ebozonne/season-card](https://github.com/ebozonne/season-card)

---

## Aperçu

![Fonctionnalités](docs/readme/QuatreSaisons_features.jpg)

- **Température ressentie** — approximation simple (vent et humidité).
- **Fond coloré + motifs** (PNG) — teinte liée à la température ; adaptation **clair / sombre** au thème.
- **Parapluie** — affichage si risque de pluie dans les **24 h** (prévisions horaires HA).
- **Soleil** — heures de lever et de coucher.
- **Curseur de saison** — pilotage d’un `input_select` à trois options (automations, modes, etc.).

![Thèmes clair et sombre](docs/readme/QuatreSaisons_themes.jpg)

---

## Prérequis

| Élément | Obligatoire ? |
|--------|----------------|
| Helper **`input_select`** avec **exactement les options** que vous utiliserez partout (automations, scripts, etc.) | **Oui** — seule exigence « métier » de la carte. |

Pour la carte **avec météo**, la configuration **standard** comporte **trois** lignes YAML (voir [ci-dessous](#configuration-standard-usage)) : `type`, `entity`, **`weather_entity`**. Cette dernière reste **votre** entité (`weather.*`) — l’exemple `weather.forecast_maison` est seulement celui d’une instance de référence.

Sans **`weather_entity`**, le bandeau météo reste masqué (le curseur saison fonctionne seul). Les prévisions pour le **☂️** dépendent de l’entité météo (`weather.get_forecasts` ou équivalent) ; sinon le bloc pluie peut rester vide.

> Le domaine **`weather`** n’est pas un « paquet à installer » pour la carte : c’est le type d’entité que vous pointez dans **`weather_entity`**.

---

## Exemple réel : `input_select.season`

La carte affiche les **libellés tels qu’ils sont définis** dans le helper (ordre YAML = positions gauche → droite sur le rail). Les couleurs du rail s’appuient sur des mots-clés dans le texte de l’option (par ex. `WINTER`, `MID` / mi-saison, `SUMMER` / été).

Exemple aligné sur une instance de référence (nom d’entité **`season`**, nom affiché **SEASON**, icône **`mdi:sun-snowflake-variant`**) :

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

> À ne pas confondre avec une intégration ou un service nommé « season » : ici il s’agit **uniquement** d’un helper **`input_select`**.

Après modification du YAML : vérifier la configuration Home Assistant, puis recharger les **entités d’entrée** (ou redémarrer si votre mode d’édition l’exige).

---

## Installation via HACS

1. **HACS** → menu **⋮** → **Dépôts personnalisés** → URL `https://github.com/ebozonne/season-card`, catégorie **Dashboard** (plugin Lovelace).
2. **HACS** → **Frontend** (ou équivalent) → **Season Card** → **Télécharger**.
3. Ajoutez la carte au tableau (`Ajouter une carte` → **Season Card**, ou YAML `type: custom:season-card`).

---

## Installation manuelle (sans HACS)

1. Copier **le contenu** du dossier **`dist/`** de ce dépôt vers **`config/www/season-card/`** (à la racine de ce dossier : `season-card.js`, `temperature-colorscale.json`, dossier `season-icons/`, etc.).
2. **Paramètres** → **Tableaux de bord** → **Ressources** → **Ajouter une ressource** : URL **`/local/season-card/season-card.js`**, type **JavaScript module**. En cas de cache navigateur tenace, vous pouvez ajouter un paramètre de version dans l’URL (`?v=…`).

---

## Configuration standard (usage)

Les trois lignes **attendues** pour une utilisation « carte complète » (curseur + météo) :

```yaml
type: custom:season-card
entity: input_select.season
weather_entity: weather.forecast_maison   # remplacer par votre weather.*
```

- **`type`** et **`entity`** : requis côté Lovelace / carte (`entity` = votre `input_select`).
- **`weather_entity`** : vous choisissez **quelle** entité `weather.*` alimente le bandeau ; l’exemple ci-dessus n’est qu’une valeur d’instance.

---

## Mode slider seul (sans météo)

Si vous voulez uniquement le sélecteur saison :

```yaml
type: custom:season-card
entity: input_select.season
```

---

## Mode météo seule (sans sélecteur)

Si vous voulez uniquement le bandeau météo, omettez `entity` et ne gardez que :

```yaml
type: custom:season-card
weather_entity: weather.forecast_maison
```

---

## Options démo (hors usage courant)

À utiliser **ponctuellement** pour tester l’UI, puis retirer ou remettre aux valeurs par défaut.

| Paramètre | Défaut | Exemple | Rôle |
|-----------|--------|---------|------|
| `external_temp` | *(absent)* | `32` | Force une température **°C** (motifs, ambiance, ressenti, **T** affichée) sans modifier la météo réelle. |
| `weather_rain_umbrella_force` | `false` | `true` | Affiche le bloc **☂️** comme s’il y avait une alerte, **sans** appeler les prévisions. |

---

## Licence

Voir le fichier [`LICENSE`](LICENSE) (MIT).
