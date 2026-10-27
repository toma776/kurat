// Registrul entităților kurat.ro — singurul loc în care se declară un tip (standard §0.9, §1.1).
// Tabelele, cheile străine, tabelele de legătură, formularele, harta și „Unde apare” derivă de aici.

// desc: o frază pentru cardul categoriei din /manage/entitati (ce găsești acolo)
export const CATEGORIES = {
  firma: {label: 'Firmă', color: '#0f766e', desc: 'Datele firmei: nume, contact, adresă, date legale, cifre și ratingul. Sursa jetoanelor folosite în texte.'},
  servicii: {label: 'Servicii și prețuri', color: '#2f74c4', desc: 'Ce oferă Kurat: serviciile, operațiunile incluse, tarifele, serviciile suplimentare și calculatorul de preț.'},
  incredere: {label: 'Încredere', color: '#b45309', desc: 'Dovezile care conving: clienți, testimoniale, garanția, certificate, studii de caz și echipa.'},
  continut: {label: 'Conținut', color: '#7c3aed', desc: 'Textele de pe homepage: avantaje, valori, pașii de lucru și întrebările frecvente.'},
  site: {label: 'Site', color: '#475569', desc: 'Structura site-ului: paginile, secțiunile din care sunt compuse și meniurile.'},
  magazin: {label: 'Magazin', color: '#be185d', desc: 'Produsele de curățenie vândute pe site.'},
  operational: {label: 'Operațional', color: '#64748b', desc: 'Ce vine de pe site: cererile de ofertă trimise din formular și din calculator.'}
};

const order = {key: 'ordine', label: 'Ordine', type: 'int', list: true};
// Pentru cine e o informație: homepage-ul are două drumuri (casă / firmă), alese din comutatorul din hero.
const AUDIENCE = [['ambele', 'Casă și firme'], ['casa', 'Pentru casă'], ['firma', 'Pentru firme']];
const audience = {key: 'public', label: 'Public', type: 'select', options: AUDIENCE, list: true};

export const ENTITIES = [
  {
    key: 'firma', table: 'company', label: 'Date firmă', one: 'Date firmă',
    category: 'firma', icon: 'building', singleton: true, noStatus: true, title: 'nume',
    tokenize: false, // e sursa jetoanelor, nu primește jetoane
    fields: [
      {key: 'nume', label: 'Nume comercial', type: 'text', required: true},
      {key: 'denumire_legala', label: 'Denumire legală', type: 'text'},
      {key: 'telefon', label: 'Telefon', type: 'phone', required: true, token: 'telefon'},
      {key: 'whatsapp', label: 'WhatsApp', type: 'phone', token: 'whatsapp'},
      {key: 'email', label: 'Email contact', type: 'email', required: true, token: 'email'},
      {key: 'email_comenzi', label: 'Email comenzi (magazin)', type: 'email', token: 'email-comenzi'},
      {key: 'adresa', label: 'Stradă și număr', type: 'text', token: 'adresa'},
      {key: 'cod_postal', label: 'Cod poștal', type: 'text', max: 6},
      {key: 'oras', label: 'Oraș', type: 'text'},
      {key: 'tara', label: 'Țară', type: 'text'},
      {key: 'cui', label: 'CUI', type: 'text'},
      {key: 'reg_com', label: 'Nr. Reg. Com.', type: 'text'},
      {key: 'iban', label: 'IBAN', type: 'text'},
      {key: 'an_infiintare', label: 'Anul înființării', type: 'int', token: 'ani'},
      {key: 'slogan', label: 'Descriere scurtă (subsol)', type: 'textarea'},
      {key: 'rating', label: 'Rating', type: 'number'},
      {key: 'locuinte_curatate', label: 'Locuințe curățate', type: 'int'},
      {key: 'clienti_multumiti', label: 'Clienți mulțumiți', type: 'int'},
      {key: 'birouri_curatate', label: 'Birouri curățate', type: 'int'},
      {key: 'prezentare_url', label: 'Prezentarea companiei (link)', type: 'url'},
      {key: 'anpc_sal', label: 'Link ANPC SAL', type: 'url'},
      {key: 'anpc_sol', label: 'Link platforma SOL', type: 'url'},
      // dovezile verificabile: se afișează doar cu sursa confirmată
      {key: 'google_url', label: 'Profil Google Business (link)', type: 'url'},
      {key: 'google_rating', label: 'Rating Google', type: 'number'},
      {key: 'google_recenzii', label: 'Număr recenzii Google', type: 'int'},
      {key: 'timp_raspuns', label: 'Timp de răspuns promis (de ex. „sub 30 de minute, L–V 8–20”)', type: 'text'},
      {key: 'program', label: 'Program', type: 'text'},
      {key: 'zona', label: 'Zona acoperită', type: 'text', token: 'zona'},
      {key: 'cota_tva', label: 'Cota TVA (%)', type: 'number'}
    ],
    validate(r) {
      const e = [];
      if (r.cod_postal && !/^\d{6}$/.test(r.cod_postal)) e.push(['cod_postal', 'Codul poștal din România are 6 cifre.']);
      return e;
    }
  },

  {
    // Un singur tip pentru tot ce stă sub /servicii/: tipuri de spațiu și tipuri de curățenie.
    // Așa adresa rămâne unică între ele, iar cardurile din homepage trimit la un singur tip.
    key: 'servicii', table: 'services', label: 'Servicii', one: 'Serviciu',
    category: 'servicii', color: '#2f74c4', icon: 'sparkles', thumb: 'imagine_id', title: 'nume',
    mentions: true, mentionName: 'nume_scurt', aliases: 'aliasuri',
    public: {path: r => r.pagina && r.slug ? `/servicii/${r.slug}` : null},
    linkFields: ['nume', 'nume_scurt', 'slug', 'pagina'],
    duplicates: {by: ['nume']},
    fields: [
      {key: 'fel', label: 'Fel', type: 'select', required: true, list: true,
       options: [['spatiu', 'După tipul spațiului'], ['curatenie', 'După tipul curățeniei']]},
      {key: 'nume', label: 'Nume', type: 'text', required: true, max: 120, list: true},
      {key: 'nume_scurt', label: 'Nume scurt (meniu, carduri)', type: 'text', max: 60},
      {key: 'aliasuri', label: 'Alte denumiri', type: 'list'},
      {key: 'slug', label: 'Identificator (adresă)', type: 'slug', from: 'nume'},
      {key: 'pagina', label: 'Are pagină proprie', type: 'boolean'},
      {key: 'descriere', label: 'Descriere', type: 'textarea'},
      {key: 'imagine_id', label: 'Imagine', type: 'image'},
      {key: 'acopera', label: 'Zone acoperite', type: 'list'},
      {key: 'sarcini', label: 'Ce includem', type: 'refs', target: 'sarcini', ordered: true, owned: true,
       rel: 'include', inverseLabel: 'Servicii', attrs: [{key: 'grup', label: 'Grup (Baie, Bucătărie…)', type: 'text'}]},
      {key: 'extra', label: 'Servicii suplimentare', type: 'refs', target: 'extra', ordered: true,
       rel: 'oferă suplimentar', inverseLabel: 'Servicii'},
      {key: 'tarif_mp', label: 'Tarif calculator (lei/mp)', type: 'money'},
      {key: 'cheie_calculator', label: 'Cheie în calculator', type: 'text', intern: true},
      audience,
      {key: 'icon', label: 'Iconiță', type: 'text', max: 30},
      {key: 'culoare', label: 'Culoare (calculator)', type: 'text', max: 9},
      {key: 'calc_eticheta', label: 'Eticheta în calculator (scurtă)', type: 'text', max: 40},
      {key: 'calc_descriere', label: 'Descrierea în calculator (o linie)', type: 'text', max: 60},
      {key: 'durata', label: 'Durată orientativă (de ex. „3–5 ore”)', type: 'text'}
    ],
    validate(r) {
      const e = [];
      if (r.tarif_mp != null && r.fel !== 'curatenie') e.push(['tarif_mp', 'Doar tipurile de curățenie au tarif pe mp.']);
      if (r.pagina && !r.slug) e.push(['slug', 'Un serviciu cu pagină proprie are nevoie de adresă.']);
      return e;
    }
  },

  {
    key: 'tarife', table: 'prices', label: 'Tarife', one: 'Tarif',
    category: 'servicii', color: '#1d4ed8', icon: 'tag', title: 'eticheta',
    approval: true,
    duplicates: {by: ['serviciu_id', 'eticheta']},
    fields: [
      {key: 'serviciu_id', label: 'Serviciu', type: 'ref', target: 'servicii', required: true,
       rel: 'are tariful', inverseLabel: 'Tarife', only: r => r.fel === 'curatenie', onTargetDelete: 'blochează'},
      {key: 'eticheta', label: 'Etichetă (1–2 camere, 20–60 mp…)', type: 'text', required: true, list: true},
      {key: 'pret', label: 'Preț', type: 'money', list: true},
      {key: 'pret_max', label: 'Preț maxim (interval)', type: 'money'},
      {key: 'la_cerere', label: 'Preț la cerere', type: 'boolean'},
      {key: 'plus_tva', label: '+ TVA', type: 'boolean'},
      order
    ],
    validate(r) {
      const e = [];
      if (!r.la_cerere && r.pret == null) e.push(['pret', 'Un tarif are preț sau e „la cerere”.']);
      if (r.pret_max != null && r.pret != null && r.pret_max < r.pret) e.push(['pret_max', 'Prețul maxim e mai mic decât cel minim.']);
      return e;
    }
  },

  {
    key: 'extra', table: 'extras', label: 'Servicii suplimentare', one: 'Serviciu suplimentar',
    category: 'servicii', color: '#0891b2', icon: 'plus', title: 'nume',
    approval: true,
    duplicates: {by: ['nume']},
    fields: [
      {key: 'nume', label: 'Nume', type: 'text', required: true, list: true},
      {key: 'pret', label: 'Preț', type: 'money', required: true, list: true},
      {key: 'unitate', label: 'Unitate (gol = per comandă)', type: 'text'},
      {key: 'in_calculator', label: 'Apare în calculator', type: 'boolean'}
    ]
  },

  {
    key: 'sarcini', table: 'tasks', label: 'Operațiuni incluse', one: 'Operațiune',
    category: 'servicii', color: '#64748b', icon: 'check', title: 'text', hub: false, noStatus: true,
    duplicates: {by: ['text']},
    fields: [
      {key: 'text', label: 'Text', type: 'text', required: true, max: 200, list: true}
    ]
  },

  {
    key: 'clienti', table: 'clients', label: 'Clienți', one: 'Client',
    category: 'incredere', color: '#b45309', icon: 'briefcase', thumb: 'logo_id', title: 'nume',
    mentions: true, aliases: 'aliasuri',
    duplicates: {by: ['nume']},
    fields: [
      {key: 'nume', label: 'Nume', type: 'text', required: true, list: true},
      {key: 'aliasuri', label: 'Alte denumiri', type: 'list'},
      {key: 'logo_id', label: 'Logo', type: 'image'},
      {key: 'site', label: 'Site', type: 'url'},
      {key: 'in_portofoliu', label: 'Apare în portofoliu', type: 'boolean'},
      {key: 'culoare', label: 'Culoare (inițialele din testimoniale)', type: 'text', max: 9},
      order
    ]
  },

  {
    key: 'testimoniale', table: 'testimonials', label: 'Testimoniale', one: 'Testimonial',
    category: 'incredere', color: '#d97706', icon: 'quote', title: 'text',
    approval: true, tokenize: false, // citatele clienților nu se ating (§1.6 a)
    duplicates: {by: ['text']},
    fields: [
      {key: 'text', label: 'Text', type: 'textarea', required: true, list: true},
      {key: 'client_id', label: 'Client', type: 'ref', target: 'clienti', required: true,
       rel: 'e scris de', inverseLabel: 'Testimoniale', onTargetDelete: 'blochează', list: true},
      {key: 'stele', label: 'Stele', type: 'int'},
      {key: 'sursa', label: 'Sursa', type: 'select', options: [['site', 'Site'], ['google', 'Google'], ['email', 'Email']]},
      {key: 'sursa_url', label: 'Link spre recenzia originală', type: 'url'},
      {key: 'data', label: 'Data', type: 'date'},
      {key: 'autor', label: 'Cine vorbește (nume)', type: 'text'},
      {key: 'functie', label: 'Funcția / contextul („administrator”, „apartament 3 camere”)', type: 'text'},
      audience,
      order
    ],
    validate: r => r.stele != null && (r.stele < 1 || r.stele > 5) ? [['stele', 'Între 1 și 5 stele.']] : []
  },

  {
    key: 'valori', table: 'values_kurat', label: 'Valori', one: 'Valoare',
    category: 'continut', color: '#7c3aed', icon: 'star', title: 'titlu',
    fields: [
      {key: 'litera', label: 'Litera', type: 'text', max: 1, list: true},
      {key: 'titlu', label: 'Titlu', type: 'text', required: true, list: true},
      {key: 'text', label: 'Text', type: 'textarea'},
      order
    ]
  },

  {
    key: 'avantaje', table: 'advantages', label: 'Avantaje', one: 'Avantaj',
    category: 'continut', color: '#6d28d9', icon: 'thumbs-up', title: 'titlu',
    fields: [
      {key: 'categorie', label: 'Categorie', type: 'text', list: true},
      {key: 'icon', label: 'Iconiță', type: 'text', max: 30},
      {key: 'titlu', label: 'Titlu', type: 'text', required: true, list: true},
      {key: 'text', label: 'Cu Kurat', type: 'textarea'},
      {key: 'risc_titlu', label: 'Fără Kurat — titlu', type: 'text'},
      {key: 'risc_text', label: 'Fără Kurat — text', type: 'textarea'},
      order
    ]
  },

  {
    key: 'pasi', table: 'steps', label: 'Pași și etape', one: 'Pas',
    category: 'continut', color: '#8b5cf6', icon: 'list-ordered', title: 'titlu',
    fields: [
      {key: 'grup', label: 'Grup', type: 'select', required: true, list: true,
       options: [['proces', 'Curățenie în 4 pași'], ['etape', 'Etapele fiecărei curățenii']]},
      {key: 'titlu', label: 'Titlu', type: 'text', required: true, list: true},
      {key: 'text', label: 'Text', type: 'textarea'},
      order
    ]
  },

  {
    key: 'intrebari', table: 'faq', label: 'Întrebări frecvente', one: 'Întrebare',
    category: 'continut', color: '#a855f7', icon: 'help', title: 'intrebare',
    fields: [
      {key: 'intrebare', label: 'Întrebare', type: 'text', required: true, list: true},
      {key: 'raspuns', label: 'Răspuns', type: 'richtext', required: true},
      audience,
      order
    ]
  },

  {
    // Garanția: o singură politică, la care trimit hero-ul, bara de încredere, secțiunea și FAQ-ul.
    key: 'garantie', table: 'guarantee', label: 'Garanție', one: 'Garanție',
    category: 'incredere', color: '#15803d', icon: 'shield', title: 'titlu', singleton: true, approval: true,
    fields: [
      {key: 'titlu', label: 'Titlu', type: 'text', required: true},
      {key: 'rezumat', label: 'Rezumat (o frază, apare în bara de încredere)', type: 'text', required: true, max: 160},
      {key: 'termen_ore', label: 'Termen de semnalare (ore)', type: 'int'},
      {key: 'promisiune', label: 'Promisiunea, pe pași', type: 'list'},
      {key: 'acopera', label: 'Ce acoperă', type: 'list'},
      {key: 'nu_acopera', label: 'Ce nu acoperă', type: 'list'},
      {key: 'cum_ceri', label: 'Cum o ceri', type: 'textarea'}
    ]
  },

  {
    // Dovezile de încredere: asigurare, verificarea echipei, produse, plata după verificare. Fiecare cu sursa ei.
    key: 'dovezi', table: 'proofs', label: 'Dovezi de încredere', one: 'Dovadă',
    category: 'incredere', color: '#0f766e', icon: 'badge-check', title: 'titlu', approval: true,
    fields: [
      {key: 'tip', label: 'Tip', type: 'select', required: true, list: true, options: [
        ['plata', 'Plată după verificare'], ['asigurare', 'Asigurare'], ['verificare', 'Verificarea echipei'],
        ['produse', 'Produse'], ['certificare', 'Certificare'], ['altele', 'Altele']]},
      {key: 'titlu', label: 'Titlu scurt', type: 'text', required: true, max: 60, list: true},
      {key: 'text', label: 'Explicație', type: 'textarea'},
      {key: 'valoare', label: 'Detaliul verificabil (asigurator și sumă, mărci, certificat)', type: 'text'},
      {key: 'document_id', label: 'Document (poliță, certificat)', type: 'image'},
      audience,
      order
    ]
  },

  {
    key: 'studii', table: 'case_studies', label: 'Studii de caz', one: 'Studiu de caz',
    category: 'incredere', color: '#c2410c', icon: 'images', title: 'titlu', approval: true,
    fields: [
      {key: 'titlu', label: 'Titlu', type: 'text', required: true, list: true},
      {key: 'serviciu_id', label: 'Serviciu', type: 'ref', target: 'servicii', rel: 'arată lucrarea', inverseLabel: 'Studii de caz', list: true},
      {key: 'client_id', label: 'Client (dacă a acceptat să fie numit)', type: 'ref', target: 'clienti', rel: 'e lucrarea pentru', inverseLabel: 'Studii de caz'},
      audience,
      {key: 'suprafata_mp', label: 'Suprafață (mp)', type: 'int'},
      {key: 'durata', label: 'Durată', type: 'text'},
      {key: 'echipa', label: 'Echipă (câți oameni)', type: 'int'},
      {key: 'descriere', label: 'Ce s-a făcut', type: 'textarea'},
      {key: 'inainte_id', label: 'Poză înainte', type: 'image'},
      {key: 'dupa_id', label: 'Poză după', type: 'image'},
      {key: 'citat', label: 'Citatul clientului', type: 'textarea'},
      {key: 'acord', label: 'Clientul a acceptat publicarea', type: 'boolean'},
      order
    ],
    validate: r => r.status === 'published' && !r.acord ? [['acord', 'Fără acordul clientului, studiul nu se publică.']] : []
  },

  {
    key: 'echipa', table: 'team', label: 'Echipă', one: 'Membru',
    category: 'incredere', color: '#9333ea', icon: 'users', thumb: 'poza_id', title: 'nume',
    fields: [
      {key: 'nume', label: 'Nume', type: 'text', required: true, list: true},
      {key: 'rol', label: 'Rol', type: 'text', list: true},
      {key: 'text', label: 'Câteva cuvinte', type: 'textarea'},
      {key: 'poza_id', label: 'Poză (reală)', type: 'image'},
      {key: 'acord', label: 'A acceptat apariția pe site', type: 'boolean'},
      order
    ],
    validate: r => r.status === 'published' && !r.acord ? [['acord', 'Fără acord, persoana nu apare pe site.']] : []
  },

  {
    key: 'pagini', table: 'pages', label: 'Pagini', one: 'Pagină',
    category: 'site', color: '#475569', icon: 'file', title: 'titlu',
    public: {path: r => r.path || null},
    linkFields: ['titlu', 'nume_scurt', 'path'],
    fields: [
      {key: 'titlu', label: 'Titlu', type: 'text', required: true, list: true},
      {key: 'nume_scurt', label: 'Nume în meniu', type: 'text', max: 40},
      {key: 'path', label: 'Adresă', type: 'text', required: true, unique: true, list: true},
      {key: 'meta_title', label: 'Titlu SEO', type: 'text', max: 70},
      {key: 'meta_description', label: 'Descriere SEO', type: 'textarea', max: 170},
      {key: 'sectiuni', label: 'Secțiuni', type: 'refs', target: 'sectiuni', ordered: true, owned: true,
       rel: 'conține', inverseLabel: 'Pagina'}
    ]
  },

  {
    // Secțiunile tipizate (§1.1): regulile de afișare stau separat de relațiile de business.
    key: 'sectiuni', table: 'sections', label: 'Secțiuni', one: 'Secțiune',
    category: 'site', color: '#94a3b8', icon: 'layout', title: 'titlu', hub: false,
    fields: [
      {key: 'kind', label: 'Tip secțiune', type: 'select', required: true, list: true, options: [
        ['hero', 'Hero'], ['servicii', 'Servicii pe categorii'], ['servicii-lista', 'Lista serviciilor'],
        ['avantaje', 'De ce Kurat'], ['valori', 'Valori'], ['pasi', 'Pași și etape'], ['calculator', 'Calculator'],
        ['garantie', 'Garanție'], ['testimoniale', 'Testimoniale'], ['clienti', 'Logo-uri clienți'],
        ['faq', 'Întrebări frecvente'], ['contact', 'Contact'], ['formular', 'Formular de contact'], ['harta', 'Hartă'],
        ['text', 'Text'], ['cifre', 'Cifre'], ['produse', 'Produse']]},
      {key: 'eticheta', label: 'Etichetă (deasupra titlului)', type: 'text'},
      // titlul poate avea un rând rupt (Enter) și un cuvânt evidențiat în culoarea mărcii (Accent)
      {key: 'titlu', label: 'Titlu', type: 'textarea', list: true},
      {key: 'accent', label: 'Cuvânt evidențiat în titlu', type: 'text', kinds: ['hero']},
      {key: 'intro', label: 'Introducere', type: 'textarea'},
      {key: 'insigna', label: 'Insignă deasupra titlului', type: 'text', kinds: ['hero']},
      {key: 'card_titlu', label: 'Card peste imagine — titlu', type: 'text', kinds: ['hero']},
      {key: 'card_text', label: 'Card peste imagine — text', type: 'text', kinds: ['hero']},
      {key: 'nota', label: 'Text de încheiere (deasupra butonului)', type: 'textarea', kinds: ['avantaje', 'servicii']},
      {key: 'continut', label: 'Conținut', type: 'richtext', kinds: ['text', 'hero', 'garantie']},
      {key: 'puncte', label: 'Puncte', type: 'list', kinds: ['garantie', 'calculator', 'hero']},
      {key: 'butoane', label: 'Butoane', type: 'links'},
      {key: 'imagine_id', label: 'Imagine', type: 'image', kinds: ['hero', 'text']},
      // Afișare prin regulă (§2.4): lista se calculează la randare, nu se scrie de mână.
      {key: 'filtru', label: 'Arată serviciile', type: 'select', kinds: ['servicii-lista'],
       options: [['spatiu', 'După tipul spațiului'], ['curatenie', 'După tipul curățeniei']]},
      {key: 'intro_companii', label: 'Introducere — pentru companii', type: 'textarea', kinds: ['servicii']},
      {key: 'intro_persoane', label: 'Introducere — pentru persoane fizice', type: 'textarea', kinds: ['servicii']},
      {key: 'servicii_companii', label: 'Servicii pentru companii', type: 'refs', target: 'servicii', ordered: true,
       kinds: ['servicii'], rel: 'prezintă pentru companii', inverseLabel: 'Secțiuni (companii)',
       attrs: [{key: 'titlu', type: 'text'}, {key: 'text', type: 'text'}, {key: 'puncte', type: 'list'}, {key: 'icon', type: 'text'}, {key: 'imagine', type: 'image'}]},
      {key: 'servicii_persoane', label: 'Servicii pentru persoane fizice', type: 'refs', target: 'servicii', ordered: true,
       kinds: ['servicii'], rel: 'prezintă pentru persoane', inverseLabel: 'Secțiuni (persoane)',
       attrs: [{key: 'titlu', type: 'text'}, {key: 'text', type: 'text'}, {key: 'puncte', type: 'list'}, {key: 'icon', type: 'text'}, {key: 'imagine', type: 'image'}]},
      {key: 'valori', label: 'Valori', type: 'refs', target: 'valori', ordered: true, kinds: ['valori'], rel: 'afișează', inverseLabel: 'Secțiuni'},
      {key: 'avantaje', label: 'Avantaje', type: 'refs', target: 'avantaje', ordered: true, kinds: ['avantaje'], rel: 'afișează', inverseLabel: 'Secțiuni'},
      {key: 'pasi', label: 'Pași', type: 'refs', target: 'pasi', ordered: true, kinds: ['pasi'], rel: 'afișează', inverseLabel: 'Secțiuni'},
      {key: 'intrebari', label: 'Întrebări', type: 'refs', target: 'intrebari', ordered: true, kinds: ['faq'], rel: 'afișează', inverseLabel: 'Secțiuni'},
      {key: 'testimoniale', label: 'Testimoniale', type: 'refs', target: 'testimoniale', ordered: true, kinds: ['testimoniale'], rel: 'afișează', inverseLabel: 'Secțiuni'},
      {key: 'clienti', label: 'Clienți', type: 'refs', target: 'clienti', ordered: true, kinds: ['clienti'], rel: 'afișează', inverseLabel: 'Secțiuni'},
      {key: 'dovezi', label: 'Dovezi', type: 'refs', target: 'dovezi', ordered: true, kinds: ['garantie'], rel: 'afișează', inverseLabel: 'Secțiuni'}
    ]
  },

  {
    // Meniurile trimit la entități (`ref:<tip>:<id>`); eticheta se ia din numele scurt al țintei,
    // iar `label` se scrie doar când meniul vrea alt text (§0.2: trimitem, nu copiem).
    key: 'meniuri', table: 'menus', label: 'Meniuri', one: 'Meniu',
    category: 'site', color: '#334155', icon: 'menu', title: 'titlu', noStatus: true,
    fields: [
      {key: 'cheie', label: 'Cheie', type: 'text', required: true, unique: true, intern: true},
      {key: 'titlu', label: 'Titlu', type: 'text', required: true, list: true},
      {key: 'linkuri', label: 'Linkuri', type: 'links'}
    ]
  },

  {
    key: 'calculator', table: 'calculator', label: 'Calculator preț', one: 'Calculator preț',
    category: 'servicii', color: '#0369a1', icon: 'calculator', title: 'titlu', singleton: true, noStatus: true,
    fields: [
      {key: 'titlu', label: 'Titlu', type: 'text'},
      {key: 'pret_minim', label: 'Preț minim comandă', type: 'money', required: true},
      {key: 'multiplicatori', label: 'Multiplicatori mobilier', type: 'table',
       columns: [{key: 'nivel', type: 'text'}, {key: 'eticheta', type: 'text'}, {key: 'multiplicator', type: 'number'}]}
    ]
  },

  {
    key: 'produse', table: 'products', label: 'Produse', one: 'Produs',
    category: 'magazin', color: '#be185d', icon: 'shopping-bag', thumb: 'imagine_id', title: 'nume',
    public: {path: r => r.slug ? `/shop/${r.slug}` : null},
    linkFields: ['nume', 'slug', 'pret'],
    duplicates: {by: ['nume']},
    fields: [
      {key: 'nume', label: 'Nume', type: 'text', required: true, list: true},
      {key: 'slug', label: 'Identificator (adresă)', type: 'slug', from: 'nume'},
      {key: 'pret', label: 'Preț', type: 'money', required: true, list: true},
      {key: 'descriere', label: 'Descriere', type: 'richtext'},
      {key: 'imagine_id', label: 'Imagine', type: 'image'},
      {key: 'stoc', label: 'Stoc', type: 'int'}
    ]
  },

  {
    key: 'cereri', table: 'leads', label: 'Cereri de ofertă', one: 'Cerere',
    category: 'operational', color: '#64748b', icon: 'inbox', title: 'nume',
    operational: true, noStatus: true, creatable: false, standalone: true, tokenize: false,
    fields: [
      {key: 'nume', label: 'Nume', type: 'text', required: true, list: true},
      {key: 'contact', label: 'Telefon sau email', type: 'text', required: true, list: true},
      {key: 'mesaj', label: 'Mesaj', type: 'textarea'},
      {key: 'sursa', label: 'Sursa', type: 'select', options: [['formular', 'Formular contact'], ['calculator', 'Calculator']]},
      {key: 'detalii', label: 'Detalii calculator', type: 'table'},
      {key: 'stare', label: 'Stare', type: 'select', list: true,
       options: [['noua', 'Nouă'], ['contactat', 'Contactat'], ['oferta', 'Ofertă trimisă'], ['castigat', 'Câștigat'], ['pierdut', 'Pierdut']]}
    ]
  }
];

// ———————————————————————————————————————————— derivate din registru

export const FIELD_TYPES = new Set(['text', 'textarea', 'richtext', 'slug', 'int', 'number', 'money', 'boolean', 'select',
  'multiselect', 'date', 'datetime', 'url', 'email', 'phone', 'list', 'links', 'texts', 'table', 'image', 'ref', 'refs']);

// Cuvinte care nu pot fi slug-uri / prime segmente de adresă (§1.2).
export const RESERVED = new Set(['manage', 'api', 'media', 'assets', 'sitemap.xml', 'robots.txt', 'previzualizare']);

const BY_KEY = new Map(ENTITIES.map(e => [e.key, e]));
export const entity = key => {
  const e = BY_KEY.get(key);
  if (!e) throw new Error(`Tip necunoscut: ${key}`);
  return e;
};
export const hasEntity = key => BY_KEY.has(key);

export const fieldsOf = (e, pred = () => true) => (typeof e === 'string' ? entity(e) : e).fields.filter(pred);
export const field = (key, f) => entity(key).fields.find(x => x.key === f);
export const titleOf = (key, rec) => rec ? String(rec[entity(key).title] ?? `#${rec.id}`) : '';
export const pathOf = (key, rec) => rec ? entity(key).public?.path(rec) ?? null : null;
export const relTable = (e, f) => `rel_${e.table}_${f.key}`;

// Fiecare relație e declarată o singură dată, din capătul care o deține (§2.1).
export const RELATION_TYPES = ENTITIES.flatMap(e => e.fields
  .filter(f => f.type === 'ref' || f.type === 'refs' || f.type === 'image')
  .map(f => ({
    id: `${e.key}.${f.key}`,
    source: e.key,
    field: f.key,
    target: f.type === 'image' ? 'media' : f.target,
    verb: f.rel ?? (f.type === 'image' ? 'folosește imaginea' : f.label),
    inverseLabel: f.inverseLabel ?? e.label,
    cardinality: f.type === 'refs' ? 'M:N' : 'N:1',
    storage: f.type === 'refs' ? relTable(e, f) : `${e.table}.${f.key}`,
    required: !!f.required,
    ordered: !!f.ordered,
    sensitive: !!f.sensitive,
    owned: !!f.owned,
    onTargetDelete: f.onTargetDelete ?? (f.type === 'refs' ? 'scoate legătura' : f.required ? 'blochează' : 'golește câmpul')
  })));

export const relation = id => RELATION_TYPES.find(r => r.id === id);
export const inverseRelations = key => RELATION_TYPES.filter(r => r.target === key);

// Verificări statice ale registrului; rulate la pornire și în teste.
export function checkRegistry() {
  const errors = [], tables = new Set();
  for (const e of ENTITIES) {
    if (tables.has(e.table)) errors.push(`${e.key}: tabelul ${e.table} e folosit de două ori`);
    tables.add(e.table);
    if (!e.fields.some(f => f.key === e.title)) errors.push(`${e.key}: câmpul titlu „${e.title}” nu există`);
    const keys = new Set();
    for (const f of e.fields) {
      if (keys.has(f.key)) errors.push(`${e.key}.${f.key}: cheie dublă`);
      keys.add(f.key);
      if (!FIELD_TYPES.has(f.type)) errors.push(`${e.key}.${f.key}: tip necunoscut ${f.type}`);
      if ((f.type === 'ref' || f.type === 'refs') && !hasEntity(f.target)) errors.push(`${e.key}.${f.key}: ținta ${f.target} nu există`);
      if (f.type === 'select' && !f.options?.length) errors.push(`${e.key}.${f.key}: select fără opțiuni`);
    }
    for (const lf of e.linkFields ?? []) if (!keys.has(lf)) errors.push(`${e.key}: linkFields conține ${lf}, care nu există`);
    for (const d of e.duplicates?.by ?? []) if (!keys.has(d)) errors.push(`${e.key}: duplicates.by conține ${d}, care nu există`);
  }
  return errors;
}
