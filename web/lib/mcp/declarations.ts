// Ce que le serveur MCP ANNONCE : sept outils, leur description et leur schéma d'entrée.
//
// Séparé de `outils.ts` (qui les EXÉCUTE) pour une raison précise : l'exécution touche la
// base et les Server Actions, donc `@/auth`, donc next-auth — impossible à charger hors de
// Next. Un test qui veut seulement vérifier ce qu'on annonce n'a pas à démarrer une moitié
// d'application pour le lire. La déclaration est de la DONNÉE ; elle se teste comme telle.
//
// ⚠️ Une déclaration sans exécution est un mensonge : Claude appellerait un outil que le
// `switch` d'`outils.ts` ne connaît pas. La correspondance entre les deux fichiers est
// verrouillée dans les deux sens par `tests/mcp.test.ts`.
//
// ⚠️ La DESCRIPTION est la seule chose sur laquelle Claude choisit un outil. Un outil qui
// modifie les données de Marc commence donc par « ÉCRIT. » — sinon il serait appelé comme
// s'il était inoffensif. Verrouillé aussi.

export const OUTILS_MCP = [
  {
    name: "batchchef_chercher_recettes",
    description:
      "Cherche dans les recettes de Marc et le catalogue de découverte (10 188 recettes). " +
      "Donne `ingredients` pour trouver ce qui se cuisine avec ce qu'il a sous la main : la " +
      "réponse dit pour chaque recette ce qui est COUVERT et ce qui MANQUE. `texte` cherche " +
      "par titre. Les deux se combinent.",
    inputSchema: {
      type: "object",
      properties: {
        ingredients: { type: "array", items: { type: "string" } },
        texte: { type: "string" },
        source: { type: "string", enum: ["catalogue", "mes-recettes", "tout"] },
      },
    },
  },
  {
    name: "batchchef_lire_recette",
    description: "Lit une recette en entier : ingrédients avec quantités, et préparation.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        source: { type: "string", enum: ["catalogue", "mes-recettes"] },
      },
      required: ["id", "source"],
    },
  },
  {
    name: "batchchef_lister_batchs",
    description:
      "Liste les batchs de cuisine de Marc avec leur statut (planifié, courses, cuisine, " +
      "terminé), leurs recettes et le budget d'épicerie estimé.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "batchchef_lire_liste_epicerie",
    description:
      "La liste d'épicerie d'un batch : articles, quantités agrégées, ce qui est déjà pris, " +
      "et le montant estimé restant. Sel, poivre et eau n'y figurent jamais (ils ne " +
      "s'achètent pas à la recette).",
    inputSchema: {
      type: "object",
      properties: { batchId: { type: "number" } },
      required: ["batchId"],
    },
  },
  {
    name: "batchchef_creer_batch",
    description:
      "ÉCRIT. Crée un batch de cuisine à partir de recettes de la bibliothèque de Marc, avec " +
      "le nombre de portions voulu pour chacune. Génère la liste d'épicerie agrégée et son " +
      "estimation de prix. Utilise batchchef_ajouter_recette_du_catalogue d'abord si la " +
      "recette n'est pas encore dans sa bibliothèque.",
    inputSchema: {
      type: "object",
      properties: {
        nom: { type: "string" },
        recettes: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "number" }, portions: { type: "number" } },
            required: ["id", "portions"],
          },
        },
      },
      required: ["nom", "recettes"],
    },
  },
  {
    name: "batchchef_ajouter_recette_du_catalogue",
    description:
      "ÉCRIT. Copie une ou plusieurs recettes du catalogue vers la bibliothèque de Marc. " +
      "Sans appel LLM, sans coût. Les recettes déjà présentes sont ignorées.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "number" } } },
      required: ["ids"],
    },
  },
  {
    name: "batchchef_cocher_article",
    description:
      "ÉCRIT. Marque un article de liste d'épicerie comme pris (ou le décoche).",
    inputSchema: {
      type: "object",
      properties: { articleId: { type: "number" }, pris: { type: "boolean" } },
      required: ["articleId", "pris"],
    },
  },
] as const;

