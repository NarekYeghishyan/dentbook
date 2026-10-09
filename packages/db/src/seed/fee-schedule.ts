/**
 * Каталог услуг из прайса «Dental Practice – Patient Fee Schedule 2026» (Dental_Pricing_2026.pdf,
 * стр. 1–3). Прейскурант лаборатории (стр. 4–5) — это B2B, не записи пациентов, и сюда не входит.
 *
 * В PDF цена — диапазон, а длительности нет. Берём нижнюю границу «Cash / Self-Pay»
 * и одну длительность на всех (FEE_SCHEDULE_DURATION_MIN): клиника подправляет их в админке.
 */
export const FEE_SCHEDULE_DURATION_MIN = 30;

/** [название, нижняя граница цены Cash / Self-Pay, USD] */
type Row = readonly [name: string, cashFrom: number];

export const FEE_SCHEDULE: readonly { category: string; services: readonly Row[] }[] = [
  {
    category: 'Diagnostic & Preventive',
    services: [
      ['Comprehensive exam (new patient)', 60],
      ['Periodic exam', 40],
      ['Emergency / limited exam', 60],
      ['Bitewing X-rays (4)', 40],
      ['Full-mouth X-rays (FMX)', 90],
      ['Panoramic X-ray', 80],
      ['Extended CT scan (CBCT)', 150],
      ['Adult cleaning (prophy)', 80],
      ['Child cleaning', 60],
      ['Fluoride varnish', 25],
      ['Sealant (per tooth)', 35],
      ['Periodontal maintenance', 120],
      ['Full-mouth debridement', 120],
      ['Deep cleaning / SRP (per quadrant)', 150],
      ['Deep cleaning / SRP (full mouth, 4 quads)', 550],
    ],
  },
  {
    category: 'Restorative',
    services: [
      ['Composite filling – 1 surface', 120],
      ['Composite filling – 2 surfaces', 160],
      ['Composite filling – 3+ surfaces', 200],
      ['Anterior composite (front tooth)', 130],
      ['Core buildup', 150],
      ['Post & core', 350],
      ['Temporary crown (chairside)', 40],
      ['Re-cement crown', 60],
      ['Inlay / onlay (e.max or zirconia)', 700],
      ['Crown – zirconia', 950],
      ['Crown – PFM (porcelain-fused-to-metal)', 850],
      ['Crown – e.max', 1000],
      ['Veneer – e.max', 950],
      ['Veneer – composite', 250],
    ],
  },
  {
    category: 'Bridges',
    services: [
      ['Bridge unit – zirconia (per tooth)', 950],
      ['Bridge unit – PFM (per tooth)', 850],
      ['3-unit zirconia bridge (total)', 2850],
      ['Maryland (bonded) bridge', 900],
      ['Temporary bridge (per unit)', 60],
    ],
  },
  {
    category: 'Endodontics (Root Canals)',
    services: [
      ['Root canal – front tooth', 650],
      ['Root canal – premolar', 750],
      ['Root canal – molar', 900],
      ['Root canal retreatment', 900],
      ['Pulpotomy', 150],
    ],
  },
  {
    category: 'Oral Surgery',
    services: [
      ['Simple extraction', 125],
      ['Surgical extraction', 225],
      ['Wisdom tooth – erupted', 250],
      ['Wisdom tooth – soft-tissue impaction', 300],
      ['Wisdom tooth – bony impaction', 400],
      ['Bone graft / socket preservation', 450],
      ['PRF (platelet-rich fibrin)', 150],
      ['Closed sinus lift', 1200],
      ['Open (lateral) sinus lift', 2200],
      ['Alveoloplasty (per quadrant)', 200],
    ],
  },
  {
    category: 'Implants',
    services: [
      ['Implant placement (fixture)', 1800],
      ['Custom abutment', 450],
      ['Implant crown – zirconia', 1200],
      ['Single implant package (fixture + abutment + crown)', 3450],
      ['Implant bridge (per unit)', 1100],
      ['Implant overdenture (2 implants + locators)', 6000],
      ['All-on-4 / All-on-X (per arch, final zirconia)', 14000],
      ['Healing abutment / 2nd stage', 150],
    ],
  },
  {
    category: 'Dentures & Partials',
    services: [
      ['Complete denture – economy (per arch)', 800],
      ['Complete denture – standard (per arch)', 1200],
      ['Complete denture – premium (per arch)', 1900],
      ['Immediate denture (per arch)', 1300],
      ['Partial denture – acrylic', 700],
      ['Partial denture – cast metal', 1200],
      ['Partial denture – flexible (Valplast type)', 1000],
      ['Flipper (1–2 teeth)', 300],
      ['Denture reline – chairside', 200],
      ['Denture reline – lab processed', 300],
      ['Denture repair', 100],
      ['Add tooth to denture/partial', 120],
    ],
  },
  {
    category: 'Periodontal',
    services: [
      ['Gingivectomy (per tooth)', 150],
      ['Crown lengthening', 500],
      ['Gum graft (per site)', 700],
      ['Local antibiotic (per site)', 40],
    ],
  },
  {
    category: 'Cosmetic, Appliances & Other',
    services: [
      ['Teeth whitening – in-office', 400],
      ['Teeth whitening – take-home custom trays', 250],
      ['Whitening combo (in-office + trays)', 600],
      ['Night guard (hard, custom)', 350],
      ['Sports mouth guard', 150],
      ['Clear aligners (full case)', 3500],
      ['Clear retainer (each)', 150],
      ['Nitrous oxide', 60],
      ['Oral sedation', 150],
    ],
  },
];
