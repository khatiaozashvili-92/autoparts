/**
 * Seed data (docs/03 §14).
 *
 * Enough to exercise steps 3–11 against MockFitmentProvider with no commercial
 * data licence: real category vocabulary in both languages, real OEM numbers,
 * partners with different reliability, and fitment rows that deliberately
 * conflict so the §17 resolution flow has something to resolve.
 */

export interface CategorySeed {
  slug: string;
  ka: string;
  en: string;
  synonymsKa: string[];
  synonymsEn: string[];
  /** Attributes the fitment engine needs before it can decide (docs/05 §4). */
  required: string[];
}

/** The 18 categories of PRD §14. */
export const CATEGORIES: CategorySeed[] = [
  { slug: 'engine', ka: 'ძრავი', en: 'Engine',
    synonymsKa: ['მოტორი', 'ძრავა'], synonymsEn: ['motor'],
    required: ['engine_code'] },
  { slug: 'brakes', ka: 'სამუხრუჭე სისტემა', en: 'Brakes',
    synonymsKa: ['მუხრუჭი', 'მუხრუჭები', 'ხუნდები'], synonymsEn: ['brake', 'braking'],
    // Front vs rear lives on the master part, not on the car: a vehicle has no
    // 'axle' attribute, and requiring one hid the whole category (migration 0003).
    required: [] },
  { slug: 'suspension', ka: 'სავალი ნაწილი', en: 'Suspension',
    synonymsKa: ['ამორტიზატორი', 'სავალი'], synonymsEn: ['shock', 'strut'],
    required: [] },
  { slug: 'steering', ka: 'საჭე', en: 'Steering',
    synonymsKa: ['მართვა', 'რულევოი'], synonymsEn: ['rack'], required: [] },
  { slug: 'transmission', ka: 'ტრანსმისია', en: 'Transmission',
    synonymsKa: ['კოლოფი', 'გადაცემათა კოლოფი'], synonymsEn: ['gearbox', 'clutch'],
    required: ['transmission'] },
  { slug: 'electrical', ka: 'ელექტროობა', en: 'Electrical',
    synonymsKa: ['ელექტრო', 'აკუმულატორი', 'გენერატორი'], synonymsEn: ['battery', 'alternator'],
    required: [] },
  { slug: 'cooling', ka: 'გაგრილება', en: 'Cooling',
    synonymsKa: ['რადიატორი', 'გამაგრილებელი'], synonymsEn: ['radiator', 'coolant'],
    required: ['engine_code'] },
  { slug: 'fuel-system', ka: 'საწვავის სისტემა', en: 'Fuel System',
    synonymsKa: ['საწვავი', 'ბენზინი'], synonymsEn: ['fuel', 'injector'],
    required: ['engine_code', 'fuel_type'] },
  { slug: 'exhaust', ka: 'გამონაბოლქვი', en: 'Exhaust',
    synonymsKa: ['გლუშიტელი', 'გამონაბოლქვის სისტემა'], synonymsEn: ['muffler', 'catalytic'],
    required: ['engine_code'] },
  { slug: 'body', ka: 'ძარა', en: 'Body',
    synonymsKa: ['კუზოვი', 'ბამპერი', 'საქარე მინა'], synonymsEn: ['bumper', 'windshield', 'glass'],
    required: ['body_type'] },
  { slug: 'lighting', ka: 'განათება', en: 'Lighting',
    synonymsKa: ['ფარი', 'ფარები', 'სტოპი'], synonymsEn: ['headlight', 'tail light'],
    required: ['body_type'] },
  { slug: 'interior', ka: 'სალონი', en: 'Interior',
    synonymsKa: ['ინტერიერი'], synonymsEn: [], required: [] },
  { slug: 'hvac', ka: 'კონდიციონერი', en: 'HVAC',
    synonymsKa: ['კონდიცონერი', 'გათბობა', 'ღუმელი'], synonymsEn: ['air conditioning', 'heater'],
    required: [] },
  { slug: 'filters', ka: 'ფილტრები', en: 'Filters',
    synonymsKa: ['ფილტრი'], synonymsEn: ['filter'], required: ['engine_code'] },
  { slug: 'oils-fluids', ka: 'ზეთები და სითხეები', en: 'Oils & Fluids',
    synonymsKa: ['ზეთი', 'ანტიფრიზი', 'სითხე'], synonymsEn: ['oil', 'coolant', 'fluid'],
    required: [] },
  { slug: 'wheels', ka: 'დისკები', en: 'Wheels',
    synonymsKa: ['დისკი', 'თვალი'], synonymsEn: ['rim', 'wheel'], required: [] },
  { slug: 'tires', ka: 'საბურავები', en: 'Tires',
    synonymsKa: ['საბურავი', 'რეზინი', 'საბურავები'], synonymsEn: ['tyre', 'tire'], required: [] },
  { slug: 'accessories', ka: 'აქსესუარები', en: 'Accessories',
    synonymsKa: ['აქსესუარი'], synonymsEn: ['accessory'], required: [] },
];

export interface BrandSeed {
  name: string;
  type: 'ORIGINAL_OEM' | 'AFTERMARKET' | 'UNKNOWN';
}

export const BRANDS: BrandSeed[] = [
  { name: 'Toyota', type: 'ORIGINAL_OEM' },
  { name: 'Mercedes-Benz', type: 'ORIGINAL_OEM' },
  { name: 'BMW', type: 'ORIGINAL_OEM' },
  { name: 'Ford', type: 'ORIGINAL_OEM' },
  { name: 'Honda', type: 'ORIGINAL_OEM' },
  { name: 'Hyundai', type: 'ORIGINAL_OEM' },
  { name: 'Subaru', type: 'ORIGINAL_OEM' },
  { name: 'Nissan', type: 'ORIGINAL_OEM' },
  { name: 'Volkswagen', type: 'ORIGINAL_OEM' },
  { name: 'Lexus', type: 'ORIGINAL_OEM' },
  { name: 'Kia', type: 'ORIGINAL_OEM' },
  { name: 'Jeep', type: 'ORIGINAL_OEM' },
  { name: 'Chevrolet', type: 'ORIGINAL_OEM' },
  { name: 'Audi', type: 'ORIGINAL_OEM' },
  { name: 'Mitsubishi', type: 'ORIGINAL_OEM' },
  // Called out separately in PRD §5 as important for the Georgian market.
  { name: 'Opel', type: 'ORIGINAL_OEM' },
  { name: 'Bosch', type: 'AFTERMARKET' },
  { name: 'Brembo', type: 'AFTERMARKET' },
  { name: 'TRW', type: 'AFTERMARKET' },
  { name: 'Denso', type: 'AFTERMARKET' },
  { name: 'Mann-Filter', type: 'AFTERMARKET' },
  { name: 'Sachs', type: 'AFTERMARKET' },
  { name: 'Pilkington', type: 'AFTERMARKET' },
  { name: 'Valeo', type: 'AFTERMARKET' },
  { name: 'NGK', type: 'AFTERMARKET' },
  { name: 'Varta', type: 'AFTERMARKET' },
  { name: 'No Name', type: 'UNKNOWN' },
];

export interface MasterPartSeed {
  categorySlug: string;
  key: string;
  ka: string;
  en: string;
  synonymsKa: string[];
  position?: string;
  axle?: string;
}

export const MASTER_PARTS: MasterPartSeed[] = [
  { categorySlug: 'brakes', key: 'brake-pads-front', ka: 'წინა სამუხრუჭე ხუნდები', en: 'Front Brake Pads', synonymsKa: ['ხუნდები წინა', 'კალოდკები'], axle: 'FRONT_AXLE' },
  { categorySlug: 'brakes', key: 'brake-pads-rear', ka: 'უკანა სამუხრუჭე ხუნდები', en: 'Rear Brake Pads', synonymsKa: ['ხუნდები უკანა'], axle: 'REAR_AXLE' },
  { categorySlug: 'brakes', key: 'brake-disc-front', ka: 'წინა სამუხრუჭე დისკი', en: 'Front Brake Disc', synonymsKa: ['დისკი წინა', 'ტორმოზნოი დისკი'], axle: 'FRONT_AXLE' },
  { categorySlug: 'brakes', key: 'brake-disc-rear', ka: 'უკანა სამუხრუჭე დისკი', en: 'Rear Brake Disc', synonymsKa: ['დისკი უკანა'], axle: 'REAR_AXLE' },
  { categorySlug: 'brakes', key: 'brake-caliper-front', ka: 'სამუხრუჭე სუპორტი', en: 'Brake Caliper', synonymsKa: ['სუპორტი'], axle: 'FRONT_AXLE' },
  { categorySlug: 'brakes', key: 'brake-sensor', ka: 'ხუნდის სენსორი', en: 'Brake Wear Sensor', synonymsKa: ['დატჩიკი'] },

  { categorySlug: 'filters', key: 'oil-filter', ka: 'ზეთის ფილტრი', en: 'Oil Filter', synonymsKa: ['მასლიანი ფილტრი'] },
  { categorySlug: 'filters', key: 'air-filter', ka: 'ჰაერის ფილტრი', en: 'Air Filter', synonymsKa: ['ვაზდუშნი ფილტრი'] },
  { categorySlug: 'filters', key: 'fuel-filter', ka: 'საწვავის ფილტრი', en: 'Fuel Filter', synonymsKa: ['ბენზინის ფილტრი'] },
  { categorySlug: 'filters', key: 'cabin-filter', ka: 'სალონის ფილტრი', en: 'Cabin Filter', synonymsKa: ['სალონური ფილტრი'] },

  { categorySlug: 'engine', key: 'spark-plug', ka: 'სანთელი', en: 'Spark Plug', synonymsKa: ['სვეჩი', 'სანთლები'] },
  { categorySlug: 'engine', key: 'timing-belt', ka: 'განაწილების ღვედი', en: 'Timing Belt', synonymsKa: ['რემენი', 'გრმ'] },
  { categorySlug: 'engine', key: 'drive-belt', ka: 'ამძრავის ღვედი', en: 'Drive Belt', synonymsKa: ['რემენი'] },
  { categorySlug: 'engine', key: 'engine-mount', ka: 'ძრავის ბალიში', en: 'Engine Mount', synonymsKa: ['პადუშკა'] },
  { categorySlug: 'engine', key: 'ignition-coil', ka: 'ანთების კოჭა', en: 'Ignition Coil', synonymsKa: ['კატუშკა'] },

  { categorySlug: 'suspension', key: 'shock-front', ka: 'წინა ამორტიზატორი', en: 'Front Shock Absorber', synonymsKa: ['ამორტიზატორი წინა', 'სტოიკა'], axle: 'FRONT_AXLE' },
  { categorySlug: 'suspension', key: 'shock-rear', ka: 'უკანა ამორტიზატორი', en: 'Rear Shock Absorber', synonymsKa: ['ამორტიზატორი უკანა'], axle: 'REAR_AXLE' },
  { categorySlug: 'suspension', key: 'control-arm', ka: 'ბერკეტი', en: 'Control Arm', synonymsKa: ['რიჩაგი'], axle: 'FRONT_AXLE' },
  { categorySlug: 'suspension', key: 'ball-joint', ka: 'სახსარი', en: 'Ball Joint', synonymsKa: ['შაროვაია'] },
  { categorySlug: 'suspension', key: 'coil-spring', ka: 'ზამბარა', en: 'Coil Spring', synonymsKa: ['პრუჟინა'] },

  { categorySlug: 'electrical', key: 'battery', ka: 'აკუმულატორი', en: 'Battery', synonymsKa: ['ბატარეა', 'აკუმლატორი'] },
  { categorySlug: 'electrical', key: 'alternator', ka: 'გენერატორი', en: 'Alternator', synonymsKa: ['გენერატორი'] },
  { categorySlug: 'electrical', key: 'starter', ka: 'სტარტერი', en: 'Starter', synonymsKa: ['სტარტერი'] },
  { categorySlug: 'electrical', key: 'oxygen-sensor', ka: 'ჟანგბადის სენსორი', en: 'Oxygen Sensor', synonymsKa: ['ლამბდა'] },

  { categorySlug: 'cooling', key: 'radiator', ka: 'რადიატორი', en: 'Radiator', synonymsKa: ['რადიატორი'] },
  { categorySlug: 'cooling', key: 'thermostat', ka: 'თერმოსტატი', en: 'Thermostat', synonymsKa: ['თერმოსტატი'] },
  { categorySlug: 'cooling', key: 'water-pump', ka: 'წყლის ტუმბო', en: 'Water Pump', synonymsKa: ['პომპა'] },

  { categorySlug: 'body', key: 'windshield', ka: 'საქარე მინა', en: 'Windshield', synonymsKa: ['წინა მინა', 'ლობოვოი'] },
  { categorySlug: 'body', key: 'side-mirror', ka: 'გვერდითი სარკე', en: 'Side Mirror', synonymsKa: ['სარკე'], position: 'LEFT' },
  { categorySlug: 'body', key: 'front-bumper', ka: 'წინა ბამპერი', en: 'Front Bumper', synonymsKa: ['ბამპერი წინა'], position: 'FRONT' },
  { categorySlug: 'body', key: 'rear-bumper', ka: 'უკანა ბამპერი', en: 'Rear Bumper', synonymsKa: ['ბამპერი უკანა'], position: 'REAR' },

  { categorySlug: 'lighting', key: 'headlight', ka: 'წინა ფარი', en: 'Headlight', synonymsKa: ['ფარი', 'ფარები'], position: 'FRONT' },
  { categorySlug: 'lighting', key: 'tail-light', ka: 'უკანა ფარი', en: 'Tail Light', synonymsKa: ['სტოპი'], position: 'REAR' },

  { categorySlug: 'transmission', key: 'clutch-kit', ka: 'გადაბმულობის კომპლექტი', en: 'Clutch Kit', synonymsKa: ['სცეპლენია'] },
  { categorySlug: 'transmission', key: 'transmission-filter', ka: 'კოლოფის ფილტრი', en: 'Transmission Filter', synonymsKa: [] },

  { categorySlug: 'hvac', key: 'ac-compressor', ka: 'კონდიციონერის კომპრესორი', en: 'A/C Compressor', synonymsKa: ['კომპრესორი'] },
  { categorySlug: 'oils-fluids', key: 'engine-oil', ka: 'ძრავის ზეთი', en: 'Engine Oil', synonymsKa: ['ზეთი', 'მასლო'] },
  { categorySlug: 'oils-fluids', key: 'brake-fluid', ka: 'სამუხრუჭე სითხე', en: 'Brake Fluid', synonymsKa: ['ტორმოზნაია ჟიდკოსტი'] },
];

export interface PartnerSeed {
  legalName: string;
  displayName: string;
  reliability: number;
  mode: 'API' | 'CSV' | 'MANUAL';
  locations: { name: string; address: string; lat: number; lon: number }[];
}

/** Three partners with deliberately different reliability, so ranking and the
 *  docs/06 §8.1 stock-check decision table have something to distinguish. */
export const PARTNERS: PartnerSeed[] = [
  {
    legalName: 'Auto Motors LLC', displayName: 'Auto Motors',
    reliability: 0.97, mode: 'API',
    locations: [
      { name: 'ვაჟა-ფშაველა', address: 'ვაჟა-ფშაველას გამზ. 12', lat: 41.7255, lon: 44.7495 },
      { name: 'დიდუბე', address: 'წერეთლის გამზ. 116', lat: 41.7405, lon: 44.7838 },
    ],
  },
  {
    legalName: 'Tbilisi Parts Center LLC', displayName: 'Parts Center',
    reliability: 0.88, mode: 'CSV',
    locations: [
      { name: 'ისანი', address: 'ქეთევან წამებულის 45', lat: 41.6938, lon: 44.8231 },
      { name: 'გლდანი', address: 'ხიზანიშვილის 8', lat: 41.7889, lon: 44.8104 },
    ],
  },
  {
    legalName: 'Rustavi Auto Trade LLC', displayName: 'Rustavi Auto',
    reliability: 0.74, mode: 'MANUAL',
    locations: [
      { name: 'რუსთავი ცენტრი', address: 'მეგობრობის გამზ. 20', lat: 41.5495, lon: 45.0069 },
    ],
  },
];

export interface VehicleSeed {
  vin: string;
  make: string;
  model: string;
  year: number;
  generation?: string;
  engine: string;
  engineCode: string;
  fuelType: string;
  transmission: string;
  driveType: string;
  bodyType: string;
  trim?: string;
  market: string;
}

/**
 * Ten vehicles the MockFitmentProvider can decode. US-market VINs dominate on
 * purpose: that is what Georgia actually imports (ADR-003). The BMW 228i F22
 * is the PRD's running example and must always be present.
 */
export const VEHICLES: VehicleSeed[] = [
  { vin: 'WBA1J5C50FV123456', make: 'BMW', model: '2 Series', year: 2016, generation: 'F22',
    engine: '2.0L Turbo', engineCode: 'N20B20', fuelType: 'PETROL', transmission: 'AUTOMATIC',
    driveType: 'RWD', bodyType: 'COUPE', trim: '228i', market: 'US' },
  { vin: '4T1BF1FK5HU654321', make: 'Toyota', model: 'Camry', year: 2017,
    engine: '2.5L', engineCode: '2AR-FE', fuelType: 'PETROL', transmission: 'AUTOMATIC',
    driveType: 'FWD', bodyType: 'SEDAN', trim: 'SE', market: 'US' },
  { vin: '2HKRW2H875H112233', make: 'Honda', model: 'CR-V', year: 2020,
    engine: '1.5L Turbo', engineCode: 'L15BE', fuelType: 'PETROL', transmission: 'CVT',
    driveType: 'AWD', bodyType: 'SUV', trim: 'EX', market: 'US' },
  { vin: 'JF2SKAUC7LH445566', make: 'Subaru', model: 'Forester', year: 2021,
    engine: '2.5L', engineCode: 'FB25D', fuelType: 'PETROL', transmission: 'CVT',
    driveType: 'AWD', bodyType: 'SUV', trim: 'Premium', market: 'US' },
  { vin: '4JGDA5HB8JB778899', make: 'Mercedes-Benz', model: 'GLE', year: 2018,
    engine: '3.5L', engineCode: 'M276', fuelType: 'PETROL', transmission: 'AUTOMATIC',
    driveType: 'AWD', bodyType: 'SUV', trim: '350', market: 'US' },
  { vin: '1FTEW1EP6JF990011', make: 'Ford', model: 'F-150', year: 2018,
    engine: '2.7L EcoBoost', engineCode: 'Nano', fuelType: 'PETROL', transmission: 'AUTOMATIC',
    driveType: '4WD', bodyType: 'PICKUP', trim: 'XLT', market: 'US' },
  { vin: 'KMHD84LF5JU223344', make: 'Hyundai', model: 'Elantra', year: 2018,
    engine: '2.0L', engineCode: 'Nu MPI', fuelType: 'PETROL', transmission: 'AUTOMATIC',
    driveType: 'FWD', bodyType: 'SEDAN', trim: 'SEL', market: 'US' },
  { vin: '5NPE34AF4HH556677', make: 'Hyundai', model: 'Sonata', year: 2017,
    engine: '2.4L', engineCode: 'G4KJ', fuelType: 'PETROL', transmission: 'AUTOMATIC',
    driveType: 'FWD', bodyType: 'SEDAN', trim: 'Sport', market: 'US' },
  // Two EU-market cars so market-mismatch behaviour (docs/05 §4.1) is testable.
  { vin: 'WVWZZZ1KZAW334455', make: 'Volkswagen', model: 'Golf', year: 2010, generation: 'Mk6',
    engine: '1.6 TDI', engineCode: 'CAYC', fuelType: 'DIESEL', transmission: 'MANUAL',
    driveType: 'FWD', bodyType: 'HATCHBACK', trim: 'Comfortline', market: 'EU' },
  { vin: 'W0L0AHL0885667788', make: 'Opel', model: 'Astra', year: 2008, generation: 'H',
    engine: '1.6', engineCode: 'Z16XER', fuelType: 'PETROL', transmission: 'MANUAL',
    driveType: 'FWD', bodyType: 'HATCHBACK', trim: 'Enjoy', market: 'EU' },
];
