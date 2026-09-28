# Générateur des maquettes statiques (outil de maquette, pas de code d'app).
# Usage : python _generer.py  -> écrit les .html à côté.
HEAD = '''<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BatchChef — %(titre)s (maquette)</title>
<link rel="stylesheet" href="refonte.css">
</head>
<body data-page="%(page)s"%(etats)s>
<main class="principal">
'''
TAIL = '''</main>
<script src="refonte.js"></script>
</body>
</html>
'''
def svg(d): return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>'
IC_ERR = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>')
IC_WARN = svg('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>')
IC_OK = svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>')
PLUS = svg('<path d="M12 5v14M5 12h14"/>')
CHECK = svg('<path d="M5 12.5l4.5 4.5L19 7"/>')
ETATS6 = ' data-etats="normal,vide,chargement,erreur,alerte,confirmation"'
ETATS5 = ' data-etats="normal,vide,chargement,erreur,alerte"'
ETATS4 = ' data-etats="normal,vide,chargement,erreur"'

def head(titre, page, etats=''):
    return HEAD % {'titre': titre, 'page': page, 'etats': etats}

def carte(titre, type_):
    return '''    <article class="carte carte-recette">
      <a class="plein" href="#">
        <div class="photo" role="img" aria-label="Emplacement de la photo">Photo</div>
        <div class="carte-corps">
          <h3>%s</h3>
          <div class="meta"><span class="pastille repere">%s</span><span class="num">Préparation n min</span><span class="num">Cuisson n min</span></div>
        </div>
      </a>
    </article>
''' % (titre, type_)

def squel(n):
    un = '''    <div class="carte" aria-hidden="true"><div class="squelette" style="aspect-ratio:16/10;border-radius:15px 15px 0 0"></div><div class="carte-corps"><div class="squelette" style="height:20px;width:70%"></div><div class="squelette" style="height:14px;width:45%;margin-top:12px"></div></div></div>
'''
    return un * n

def bandeau(cls, ic, titre, texte, actions, pour, role):
    act = '<div class="actions">%s</div>' % actions if actions else ''
    return '  <div class="bandeau %s" role="%s" data-pour="%s">%s<div><strong>%s</strong><span> %s</span>%s</div></div>\n' % (cls, role, pour, ic, titre, texte, act)

def ecrire(nom, contenu):
    with open(nom, 'w', encoding='utf-8', newline='\n') as f:
        f.write(contenu)

BTN_RETRY = '<button class="bouton bouton-second" type="button">Réessayer</button>'

# ---------- ACCUEIL / TA SEMAINE ----------
types = ["Plat principal", "Soupe", "Accompagnement", "Salade"]
cartes4 = ''.join(carte('Recette proposée %d' % (i + 1), t).replace('<article', '<article role="listitem"') for i, t in enumerate(types))
accueil = head('Ta semaine', 'accueil', ETATS6) + '''
  <header class="entete">
    <div>
      <p class="surtitre">Accueil</p>
      <h1>Ta semaine</h1>
      <p class="doux" data-pour="normal alerte confirmation">Quatre recettes proposées. Change-en une, ou crée le batch quand la semaine te convient.</p>
      <p class="doux" data-pour="vide chargement erreur">Aucune semaine en cours.</p>
    </div>
    <div class="ligne" data-pour="normal alerte">
      <button class="bouton bouton-second" type="button">Régénérer la semaine</button>
      <button class="bouton bouton-principal" type="button">''' + PLUS + '''Créer le batch</button>
    </div>
  </header>

''' + bandeau('erreur', IC_ERR, 'La semaine n’a pas pu être préparée.', 'Le service de suggestion ne répond pas. Rien n’a été modifié.', BTN_RETRY, 'erreur', 'alert') \
    + bandeau('alerte', IC_WARN, 'Prix non estimé.', 'Le calcul du prix a échoué : le total n’est pas affiché plutôt que deviné.', '', 'alerte', 'status') \
    + bandeau('alerte', IC_WARN, 'Régénérer remplace les quatre recettes.', 'La proposition actuelle n’est pas conservée. Cette action ne peut pas être annulée.', '<button class="bouton bouton-principal" type="button">Oui, régénérer</button> <button class="bouton bouton-second" type="button">Garder cette semaine</button>', 'confirmation', 'alertdialog') + '''
  <section aria-label="Résumé de la semaine" class="tuiles" data-pour="normal alerte confirmation" style="margin-top:16px">
    <div class="tuile"><div class="lib">Temps total</div><div class="val">n h n min</div><div class="doux petit">préparation + cuisson</div></div>
    <div class="tuile"><div class="lib">Prix estimé</div><div class="val" data-pour="normal confirmation">≈ n $</div><div class="val" data-pour="alerte">Non estimé</div><div class="petit"><span class="pastille alerte" data-pour="normal confirmation">Estimation, pas un relevé</span><span class="pastille alerte" data-pour="alerte">Calcul indisponible</span></div></div>
    <div class="tuile"><div class="lib">Sans durée connue</div><div class="val">n</div><div class="doux petit">recettes dont la source ne dit rien</div></div>
  </section>

  <div class="grille g4" role="list" aria-label="Recettes de la semaine" data-pour="normal alerte confirmation" style="margin-top:16px">
''' + cartes4 + '''  </div>

  <div class="vide" data-pour="vide">
    <h2>Pas encore de semaine proposée</h2>
    <p>BatchChef propose quatre recettes à partir de ta bibliothèque. Tu pourras en changer avant de créer le batch.</p>
    <button class="bouton bouton-principal" type="button">Proposer une semaine</button>
  </div>

  <p class="doux" data-pour="chargement" role="status" style="margin:16px 0">Préparation de la semaine en cours…</p>
  <div class="grille g4" data-pour="chargement">
''' + squel(4) + '''  </div>

  <section class="section" data-pour="normal alerte confirmation vide">
    <h2>Recettes récentes</h2>
    <p class="doux" data-pour="vide" style="margin-bottom:12px">Aucune recette pour l’instant. Importe-en une depuis un lien ou une vidéo.</p>
    <div class="grille g3" data-pour="normal alerte confirmation">
''' + carte('Recette récente 1', 'Dessert') + carte('Recette récente 2', 'Sauce et condiment') + carte('Recette récente 3', 'Entrée et apéro') + '''    </div>
  </section>
''' + TAIL
ecrire('accueil.html', accueil)

# ---------- filtres communs ----------
TYPES = ["Tous", "Plat principal", "Entrée et apéro", "Accompagnement", "Soupe", "Salade", "Dessert", "Sauce et condiment"]
onglets = ''.join('<button type="button" role="radio" aria-checked="%s">%s</button>' % ('true' if i == 0 else 'false', t) for i, t in enumerate(TYPES))
def filtres(ph):
    return '''  <div class="pile" style="margin-bottom:24px">
    <div class="ligne"><div class="champ-large"><label class="etiquette" for="q">Rechercher</label><input id="q" class="champ" type="search" placeholder="%s"></div></div>
    <div class="onglets" role="radiogroup" aria-label="Filtrer par type">%s</div>
  </div>
''' % (ph, onglets)

# ---------- RECETTES ----------
recettes = head('Mes recettes', 'recettes', ETATS4) + '''
  <header class="entete">
    <div><p class="surtitre">Bibliothèque</p><h1>Mes recettes</h1></div>
    <button class="bouton bouton-principal" type="button">''' + PLUS + '''Importer une recette</button>
  </header>
''' + filtres('Titre ou ingrédient') + bandeau('erreur', IC_ERR, 'Les recettes n’ont pas pu être chargées.', 'Vérifie ta connexion. Tes recettes ne sont pas perdues.', BTN_RETRY, 'erreur', 'alert') + '''  <div class="grille g3" data-pour="normal">
''' + carte('Recette 1', 'Plat principal') + carte('Recette 2', 'Soupe') + carte('Recette 3', 'Dessert') + carte('Recette 4', 'Salade') + carte('Recette 5', 'Accompagnement') + carte('Recette 6', 'Sauce et condiment') + '''  </div>
  <div class="grille g3" data-pour="chargement" role="status" aria-label="Chargement des recettes">
''' + squel(6) + '''  </div>
  <div class="vide" data-pour="vide">
    <h2>Aucune recette dans ta bibliothèque</h2>
    <p>Importe une recette depuis un lien ou une vidéo, ou ajoute-en une depuis le catalogue.</p>
    <div class="ligne" style="justify-content:center"><button class="bouton bouton-principal" type="button">Importer une recette</button><a class="bouton bouton-second" href="catalogue.html">Ouvrir le catalogue</a></div>
  </div>
''' + TAIL
ecrire('recettes.html', recettes)

# ---------- CATALOGUE ----------
def carte_cat(i, ty):
    return '''    <article class="carte carte-recette">
      <div class="photo" role="img" aria-label="Emplacement de la photo">Photo</div>
      <div class="carte-corps">
        <h3>Recette du catalogue %d</h3>
        <div class="meta"><span class="pastille repere">%s</span><span class="num">n min au total</span></div>
        <div class="ligne" style="margin-top:14px"><button class="bouton bouton-second" type="button">Ajouter à ma bibliothèque</button></div>
      </div>
    </article>
''' % (i, ty)
catalogue = head('Catalogue', 'catalogue', ETATS5) + '''
  <header class="entete">
    <div><p class="surtitre">Découverte</p><h1>Catalogue de découverte</h1><p class="doux">Des recettes à explorer. Rien n’est ajouté à ta bibliothèque sans ton geste.</p></div>
  </header>
''' + filtres('Titre ou ingrédient') + bandeau('erreur', IC_ERR, 'Le catalogue n’a pas pu être chargé.', 'Réessaie dans un moment.', BTN_RETRY, 'erreur', 'alert') + bandeau('succes', IC_OK, 'Recette ajoutée à ta bibliothèque.', 'Tu la retrouves dans « Mes recettes ».', '', 'alerte', 'status') + '''  <div class="grille g3" data-pour="normal alerte" style="margin-top:16px">
''' + carte_cat(1, 'Plat principal') + carte_cat(2, 'Soupe') + carte_cat(3, 'Dessert') + carte_cat(4, 'Salade') + carte_cat(5, 'Entrée et apéro') + carte_cat(6, 'Accompagnement') + '''  </div>
  <div class="grille g3" data-pour="chargement" role="status" aria-label="Chargement du catalogue">
''' + squel(6) + '''  </div>
  <div class="vide" data-pour="vide">
    <h2>Aucun résultat</h2>
    <p>Aucune recette ne correspond à cette recherche. Essaie un autre mot, ou retire le filtre de type.</p>
    <button class="bouton bouton-second" type="button">Effacer la recherche</button>
  </div>
''' + TAIL
ecrire('catalogue.html', catalogue)

# ---------- COURSES ----------
def art(nom, coche=False, qte='n unité'):
    return '      <li class="article" data-coche="%s"><span class="case" role="checkbox" aria-checked="%s" tabindex="0" aria-label="%s">%s</span><span class="nom">%s</span><span class="qte">%s</span></li>\n' % ('oui' if coche else 'non', 'true' if coche else 'false', nom, CHECK, nom, qte)
def groupe(i, t, *arts):
    return '    <section class="carte" aria-labelledby="g%d"><h3 id="g%d" style="padding:14px 16px 6px"><span class="surtitre">%s</span></h3><ul style="list-style:none;margin:0;padding:0">\n%s    </ul></section>\n' % (i, i, t, ''.join(arts))
courses = head('Liste d’épicerie', 'courses', ETATS5) + '''
  <header class="entete">
    <div><p class="surtitre">Batch</p><h1>Liste d’épicerie</h1><p class="doux num" data-pour="normal erreur alerte">n articles cochés sur n</p></div>
    <div class="ligne" data-pour="normal erreur alerte"><button class="bouton bouton-second" type="button">Partager la liste</button><button class="bouton bouton-principal" type="button">Passer à « Cuisine »</button></div>
  </header>
''' + bandeau('erreur', IC_ERR, 'Cette case n’a pas été enregistrée.', 'Elle est décochée à nouveau pour rester fidèle à ce qui est sauvegardé.', BTN_RETRY, 'erreur', 'alert') + bandeau('alerte', IC_WARN, 'Les prix sont des estimations.', 'Ils ne viennent pas d’un relevé de magasin.', '', 'alerte', 'status') + '''  <div class="pile" data-pour="normal erreur alerte" style="margin-top:16px">
''' + groupe(1, 'Groupe d’articles 1', art('Article 1', True), art('Article 2', True), art('Article 3')) + groupe(2, 'Groupe d’articles 2', art('Article 4'), art('Article 5')) + '''  </div>
  <div class="pile" data-pour="chargement" role="status" aria-label="Chargement de la liste"><div class="carte" aria-hidden="true" style="padding:16px;display:grid;gap:14px"><div class="squelette" style="height:20px;width:40%"></div><div class="squelette" style="height:28px"></div><div class="squelette" style="height:28px"></div><div class="squelette" style="height:28px"></div></div></div>
  <div class="vide" data-pour="vide">
    <h2>Aucun article à acheter</h2>
    <p>La liste se remplit à partir des recettes du batch. Ajoute une recette au batch pour la générer.</p>
    <a class="bouton bouton-principal" href="batch.html">Retour au batch</a>
  </div>
''' + TAIL
ecrire('courses.html', courses)

# ---------- ASSISTANT ----------
assistant = head('Assistant', 'assistant', ETATS4) + '''
  <header class="entete"><div><p class="surtitre">Cuisine</p><h1>Assistant</h1><p class="doux">Pose une question sur tes recettes, ta semaine ou ta liste.</p></div></header>
  <div class="fil" data-pour="normal chargement erreur" aria-live="polite">
    <div class="msg moi"><div class="qui">Toi</div>Exemple de question posée à l’assistant.</div>
    <div class="msg"><div class="qui">Assistant</div><span data-pour="normal">Exemple de réponse de l’assistant, avec le détail demandé.</span><span data-pour="chargement" role="status">L’assistant rédige sa réponse…</span><span data-pour="erreur">Réponse interrompue.</span></div>
  </div>
''' + bandeau('erreur', IC_ERR, 'La réponse n’a pas pu être générée.', 'Ta question est conservée dans le champ.', BTN_RETRY, 'erreur', 'alert') + '''  <div class="vide" data-pour="vide">
    <h2>Commence une conversation</h2>
    <p>L’assistant connaît tes recettes et ta semaine. Choisis une suggestion ou écris ta question.</p>
    <div class="ligne" style="justify-content:center"><button class="bouton bouton-second" type="button">Suggestion de question 1</button><button class="bouton bouton-second" type="button">Suggestion de question 2</button></div>
  </div>
  <form class="saisie" onsubmit="return false">
    <label class="etiquette" for="m">Ta question</label>
    <div class="ligne" style="flex-wrap:nowrap"><input id="m" class="champ" type="text" placeholder="Écris ici"><button class="bouton bouton-principal" type="submit">Envoyer</button></div>
  </form>
''' + TAIL
ecrire('assistant.html', assistant)

# ---------- BATCH ----------
etapes = [('Planifié', 'oui'), ('Courses', 'oui'), ('Cuisine', 'cours'), ('Terminé', 'non')]
li = ''
for i, (n, s) in enumerate(etapes):
    cur = ' aria-current="step"' if s == 'cours' else ''
    suf = ' (faite)' if s == 'oui' else (' (en cours)' if s == 'cours' else '')
    li += '<li%s data-fait="%s"><span class="st">Étape %d</span>%s%s</li>' % (cur, 'oui' if s == 'oui' else 'non', i + 1, n, suf)
batch = head('Batch', 'batch', ETATS4) + '''
  <header class="entete">
    <div><p class="surtitre">Batchs</p><h1>Nom du batch</h1><p class="doux" data-pour="normal erreur"><span class="pastille statut">Étape : Cuisine</span> <span class="num">n recettes</span></p></div>
    <div class="ligne" data-pour="normal erreur"><a class="bouton bouton-second" href="courses.html">Liste d’épicerie</a><button class="bouton bouton-second" type="button">Exporter les tâches</button><button class="bouton bouton-principal" type="button">Terminer le batch</button></div>
  </header>
''' + bandeau('erreur', IC_ERR, 'Le changement d’étape n’a pas été enregistré.', 'Le batch reste à l’étape « Cuisine ».', BTN_RETRY, 'erreur', 'alert') + '''  <div class="pile" data-pour="normal erreur" style="margin-top:16px">
    <ol class="etapes" aria-label="Avancement du batch">''' + li + '''</ol>
    <section class="carte" aria-labelledby="t"><h2 id="t" style="padding:16px 16px 4px">Tâches de cuisine</h2><ul style="list-style:none;margin:0;padding:0">
''' + art('Tâche 1', True, 'n min') + art('Tâche 2', False, 'n min') + art('Tâche 3', False, 'n min') + '''    </ul></section>
    <section aria-labelledby="r"><h2 id="r" style="margin-bottom:12px">Recettes du batch</h2><div class="grille g3">
''' + carte('Recette du batch 1', 'Plat principal') + carte('Recette du batch 2', 'Soupe') + carte('Recette du batch 3', 'Dessert') + '''    </div></section>
  </div>
  <div class="pile" data-pour="chargement" role="status" aria-label="Chargement du batch"><div class="carte" aria-hidden="true" style="padding:16px;display:grid;gap:14px"><div class="squelette" style="height:44px"></div><div class="squelette" style="height:28px"></div><div class="squelette" style="height:28px"></div></div></div>
  <div class="vide" data-pour="vide">
    <h2>Aucun batch pour l’instant</h2>
    <p>Un batch regroupe les recettes à cuisiner ensemble, avec leur liste d’épicerie et leurs tâches.</p>
    <a class="bouton bouton-principal" href="#">Créer un batch</a>
  </div>
''' + TAIL
ecrire('batch.html', batch)
print('ok')
