import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// [PWA-ANDROID] Garde de l'INSTALLABILITÉ sur Android (18/09/2026, demande de Marc).
//
// Ici l'app était déjà installable — et elle DOIT l'être plus que les autres : c'est une PWA
// installée qui reçoit les vidéos partagées depuis Instagram (`share_target`), donc sans
// installation, la voie normale d'import de Marc n'existe pas.
//
// Ce que ce lot a corrigé : les DEUX icônes étaient déclarées `purpose: "any maskable"`, donc
// la même image servait les deux rôles. Le motif de l'icône (une marmite) est à FOND PERDU,
// poignées comprises — sous le masque adaptatif d'Android (zone sûre = le cercle intérieur de
// 80 %), les poignées et les bords du couvercle se font ROGNER. L'icône s'affiche quand même,
// simplement coupée, et rien ne le signale. `icone-maskable-512.png` porte donc le MÊME motif
// réduit à 72 % et recentré : aucune redessinée, seulement des marges.
//
// ⚠️ CE QUE CE TEST LIT, ET QU'UN COUP D'ŒIL AU MANIFESTE NE LIT PAS : `sizes` est une
// DÉCLARATION, pas une mesure. Un manifeste qui annonce 512×512 en servant un PNG de 192 est
// faux, et Chrome croit le FICHIER. Les dimensions sont donc relues dans l'en-tête IHDR du PNG
// (13 octets après la signature, aucun outil requis).
//
// ⚠️ CE QU'IL NE PROUVE PAS : que le téléphone propose l'installation, ni qu'un lien du hub
// bascule vers l'app installée. Ça dépend de la version de Chrome, de l'installation réelle et
// d'un réglage système — aucune infrastructure ici ne peut l'observer, c'est le téléphone de
// Marc qui tranche. Dit plutôt que suggéré par la présence d'un test.

type Icone = { src: string; sizes?: string; type?: string; purpose?: string };
type Manifeste = {
    id?: string;
    start_url?: string;
    display?: string;
    launch_handler?: { client_mode?: string };
    icons?: Icone[];
};

const racine = resolve(import.meta.dirname, '..');
const manifeste = JSON.parse(readFileSync(resolve(racine, 'public/manifest.webmanifest'), 'utf-8')) as Manifeste;
const icones = manifeste.icons ?? [];

/** Dimensions RÉELLES d'un PNG, lues dans son en-tête (13 octets d'IHDR après la signature). */
function dimensionsPng(chemin: string): { largeur: number; hauteur: number } {
    const buf = readFileSync(chemin);
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buf.subarray(0, 8).equals(signature)) throw new Error(`${chemin} n'est pas un PNG`);
    return { largeur: buf.readUInt32BE(16), hauteur: buf.readUInt32BE(20) };
}

const aPourRole = (i: Icone, role: string) => (i.purpose ?? 'any').split(/\s+/).includes(role);

describe('[PWA-ANDROID] le manifeste rend l’app installable', () => {
    it('déclare une icône RASTER d’au moins 192 px de rôle « any » — pas seulement un SVG', () => {
        const raster = icones.filter((i) => i.type === 'image/png' && aPourRole(i, 'any'));
        expect(raster.length, 'aucune icône PNG de rôle « any » : Chrome refusera le WebAPK').toBeGreaterThan(0);
        const assezGrandes = raster.filter((i) => {
            const { largeur, hauteur } = dimensionsPng(resolve(racine, 'public', i.src.replace(/^\//, '')));
            return largeur >= 192 && hauteur >= 192;
        });
        expect(assezGrandes.length).toBeGreaterThan(0);
    });

    it('déclare une icône « maskable » d’au moins 512 px, DISTINCTE de l’icône normale', () => {
        // Une icône non conçue pour le masque, réutilisée comme maskable, se fait rogner les
        // bords par l'icône adaptative d'Android : elle s'affiche, simplement coupée.
        const maskables = icones.filter((i) => aPourRole(i, 'maskable'));
        expect(maskables.length, 'aucune icône maskable').toBeGreaterThan(0);
        const grande = maskables.find((i) => {
            const { largeur } = dimensionsPng(resolve(racine, 'public', i.src.replace(/^\//, '')));
            return largeur >= 512;
        });
        expect(grande, 'aucune maskable ≥ 512 px MESURÉE dans le fichier').toBeDefined();
        const normales = icones.filter((i) => aPourRole(i, 'any')).map((i) => i.src);
        expect(normales).not.toContain(grande!.src);
    });

    it('chaque icône déclarée EXISTE, et sa taille réelle correspond à ce que le manifeste annonce', () => {
        expect(icones.length).toBeGreaterThan(0);
        for (const i of icones) {
            const chemin = resolve(racine, 'public', i.src.replace(/^\//, ''));
            expect(existsSync(chemin), `${i.src} déclaré mais absent de public/`).toBe(true);
            if (i.type !== 'image/png') continue;
            const attendu = Number((i.sizes ?? '').split('x')[0]);
            const { largeur, hauteur } = dimensionsPng(chemin);
            expect(largeur, `${i.src} : le manifeste annonce ${i.sizes}, le fichier fait ${largeur}x${hauteur}`).toBe(attendu);
            expect(hauteur).toBe(attendu);
        }
    });

    it('fixe son `id` et demande `navigate-existing` — l’identité de l’installation et la réutilisation de la fenêtre', () => {
        // `id` ABSENT veut dire « mon identité est mon start_url » : le jour où start_url change,
        // Android voit une SECONDE app et en installe une deuxième au lieu de mettre à jour.
        expect(manifeste.id).toBeTruthy();
        // `navigate-existing` : un lien venu du hub réutilise la fenêtre déjà ouverte au lieu
        // d'en empiler une nouvelle. C'est la moitié « ça ouvre l'app installée » de la demande.
        expect(manifeste.launch_handler?.client_mode).toBe('navigate-existing');
        expect(manifeste.display).toBe('standalone');
    });
});
