/**
 * Каталог услуг из прайса «Dental Practice – Patient Fee Schedule 2026» (Dental_Pricing_2026.pdf,
 * стр. 1–3). Прейскурант лаборатории (стр. 4–5) — это B2B, не записи пациентов, и сюда не входит.
 *
 * В PDF цена — диапазон, а длительности нет. Берём нижнюю границу «Cash / Self-Pay» и «Insurance Fee»
 * и одну длительность на всех (FEE_SCHEDULE_DURATION_MIN): клиника подправляет их в админке.
 */
export const FEE_SCHEDULE_DURATION_MIN = 30;

/** [название, нижняя граница Cash / Self-Pay, нижняя граница Insurance Fee, USD] */
type Row = readonly [name: string, cashFrom: number, insuranceFrom: number];

export const FEE_SCHEDULE: readonly { category: string; services: readonly Row[] }[] = [
  {
    category: 'Diagnostic & Preventive',
    services: [
      ['Comprehensive exam (new patient)', 60, 100],
      ['Periodic exam', 40, 70],
      ['Emergency / limited exam', 60, 100],
      ['Bitewing X-rays (4)', 40, 70],
      ['Full-mouth X-rays (FMX)', 90, 150],
      ['Panoramic X-ray', 80, 130],
      ['Extended CT scan (CBCT)', 150, 250],
      ['Adult cleaning (prophy)', 80, 120],
      ['Child cleaning', 60, 90],
      ['Fluoride varnish', 25, 40],
      ['Sealant (per tooth)', 35, 50],
      ['Periodontal maintenance', 120, 180],
      ['Full-mouth debridement', 120, 180],
      ['Deep cleaning / SRP (per quadrant)', 150, 225],
      ['Deep cleaning / SRP (full mouth, 4 quads)', 550, 900],
    ],
  },
  {
    category: 'Restorative',
    services: [
      ['Composite filling – 1 surface', 120, 150],
      ['Composite filling – 2 surfaces', 160, 200],
      ['Composite filling – 3+ surfaces', 200, 250],
      ['Anterior composite (front tooth)', 130, 175],
      ['Core buildup', 150, 250],
      ['Post & core', 350, 500],
      ['Temporary crown (chairside)', 40, 60],
      ['Re-cement crown', 60, 90],
      ['Inlay / onlay (e.max or zirconia)', 700, 1000],
      ['Crown – zirconia', 950, 1500],
      ['Crown – PFM (porcelain-fused-to-metal)', 850, 1300],
      ['Crown – e.max', 1000, 1500],
      ['Veneer – e.max', 950, 1800],
      ['Veneer – composite', 250, 400],
    ],
  },
  {
    category: 'Bridges',
    services: [
      ['Bridge unit – zirconia (per tooth)', 950, 1400],
      ['Bridge unit – PFM (per tooth)', 850, 1300],
      ['3-unit zirconia bridge (total)', 2850, 4200],
      ['Maryland (bonded) bridge', 900, 1400],
      ['Temporary bridge (per unit)', 60, 90],
    ],
  },
  {
    category: 'Endodontics (Root Canals)',
    services: [
      ['Root canal – front tooth', 650, 900],
      ['Root canal – premolar', 750, 1100],
      ['Root canal – molar', 900, 1800],
      ['Root canal retreatment', 900, 1500],
      ['Pulpotomy', 150, 200],
    ],
  },
  {
    category: 'Oral Surgery',
    services: [
      ['Simple extraction', 125, 200],
      ['Surgical extraction', 225, 350],
      ['Wisdom tooth – erupted', 250, 400],
      ['Wisdom tooth – soft-tissue impaction', 300, 500],
      ['Wisdom tooth – bony impaction', 400, 700],
      ['Bone graft / socket preservation', 450, 1000],
      ['PRF (platelet-rich fibrin)', 150, 250],
      ['Closed sinus lift', 1200, 2500],
      ['Open (lateral) sinus lift', 2200, 4000],
      ['Alveoloplasty (per quadrant)', 200, 300],
    ],
  },
  {
    category: 'Implants',
    services: [
      ['Implant placement (fixture)', 1800, 4000],
      ['Custom abutment', 450, 700],
      ['Implant crown – zirconia', 1200, 2200],
      ['Single implant package (fixture + abutment + crown)', 3450, 6900],
      ['Implant bridge (per unit)', 1100, 1800],
      ['Implant overdenture (2 implants + locators)', 6000, 9000],
      ['All-on-4 / All-on-X (per arch, final zirconia)', 14000, 20000],
      ['Healing abutment / 2nd stage', 150, 200],
    ],
  },
  {
    category: 'Dentures & Partials',
    services: [
      ['Complete denture – economy (per arch)', 800, 1300],
      ['Complete denture – standard (per arch)', 1200, 1800],
      ['Complete denture – premium (per arch)', 1900, 2800],
      ['Immediate denture (per arch)', 1300, 2000],
      ['Partial denture – acrylic', 700, 1100],
      ['Partial denture – cast metal', 1200, 1800],
      ['Partial denture – flexible (Valplast type)', 1000, 1500],
      ['Flipper (1–2 teeth)', 300, 450],
      ['Denture reline – chairside', 200, 300],
      ['Denture reline – lab processed', 300, 400],
      ['Denture repair', 100, 150],
      ['Add tooth to denture/partial', 120, 150],
    ],
  },
  {
    category: 'Periodontal',
    services: [
      ['Gingivectomy (per tooth)', 150, 250],
      ['Crown lengthening', 500, 800],
      ['Gum graft (per site)', 700, 1000],
      ['Local antibiotic (per site)', 40, 60],
    ],
  },
  {
    category: 'Cosmetic, Appliances & Other',
    services: [
      ['Teeth whitening – in-office', 400, 500],
      ['Teeth whitening – take-home custom trays', 250, 300],
      ['Whitening combo (in-office + trays)', 600, 800],
      ['Night guard (hard, custom)', 350, 450],
      ['Sports mouth guard', 150, 200],
      ['Clear aligners (full case)', 3500, 5000],
      ['Clear retainer (each)', 150, 200],
      ['Nitrous oxide', 60, 90],
      ['Oral sedation', 150, 200],
    ],
  },
];
