// schema.org LocalBusiness and all its descendants as of schema.org 30.1, including the health-lifesci
// MedicalBusiness specialties, so pages typed as Dentist, Attorney, Restaurant, or Plumber count as
// local business structured data.
const localBusinessTypes = new Set([
  "LocalBusiness",
  "AnimalShelter",
  "ArchiveOrganization",
  "AutomotiveBusiness",
  "AutoBodyShop",
  "AutoDealer",
  "AutoPartsStore",
  "AutoRental",
  "AutoRepair",
  "AutoWash",
  "GasStation",
  "MotorcycleDealer",
  "MotorcycleRepair",
  "ChildCare",
  "Dentist",
  "DryCleaningOrLaundry",
  "EmergencyService",
  "FireStation",
  "Hospital",
  "PoliceStation",
  "EmploymentAgency",
  "EntertainmentBusiness",
  "AdultEntertainment",
  "AmusementPark",
  "ArtGallery",
  "Casino",
  "ComedyClub",
  "MovieTheater",
  "NightClub",
  "FinancialService",
  "AccountingService",
  "AutomatedTeller",
  "BankOrCreditUnion",
  "InsuranceAgency",
  "FoodEstablishment",
  "Bakery",
  "BarOrPub",
  "Brewery",
  "CafeOrCoffeeShop",
  "Distillery",
  "FastFoodRestaurant",
  "IceCreamShop",
  "Restaurant",
  "Winery",
  "GovernmentOffice",
  "PostOffice",
  "HealthAndBeautyBusiness",
  "BeautySalon",
  "DaySpa",
  "HairSalon",
  "HealthClub",
  "NailSalon",
  "TattooParlor",
  "HomeAndConstructionBusiness",
  "Electrician",
  "GeneralContractor",
  "HVACBusiness",
  "HousePainter",
  "Locksmith",
  "MovingCompany",
  "Plumber",
  "RoofingContractor",
  "InternetCafe",
  "LegalService",
  "Attorney",
  "Notary",
  "Library",
  "LodgingBusiness",
  "BedAndBreakfast",
  "Campground",
  "Hostel",
  "Hotel",
  "Motel",
  "Resort",
  "SkiResort",
  "VacationRental",
  "MedicalBusiness",
  "Audiology",
  "CommunityHealth",
  "Dermatology",
  "DietNutrition",
  "Emergency",
  "Geriatric",
  "Gynecologic",
  "MedicalClinic",
  "CovidTestingFacility",
  "Midwifery",
  "Nursing",
  "Obstetric",
  "Oncologic",
  "Ophthalmology",
  "Optician",
  "Optometric",
  "Otolaryngologic",
  "Pediatric",
  "Pharmacy",
  "Physician",
  "IndividualPhysician",
  "PhysiciansOffice",
  "Physiotherapy",
  "PlasticSurgery",
  "Podiatric",
  "PrimaryCare",
  "Psychiatric",
  "PublicHealth",
  "ProfessionalService",
  "RadioStation",
  "RealEstateAgent",
  "RecyclingCenter",
  "SelfStorage",
  "ShoppingCenter",
  "SportsActivityLocation",
  "BowlingAlley",
  "ExerciseGym",
  "GolfCourse",
  "PublicSwimmingPool",
  "SportsClub",
  "StadiumOrArena",
  "TennisComplex",
  "Store",
  "BikeStore",
  "BookStore",
  "ClothingStore",
  "ComputerStore",
  "ConvenienceStore",
  "DepartmentStore",
  "ElectronicsStore",
  "Florist",
  "FurnitureStore",
  "GardenStore",
  "GroceryStore",
  "HardwareStore",
  "HobbyShop",
  "HomeGoodsStore",
  "JewelryStore",
  "LiquorStore",
  "MensClothingStore",
  "MobilePhoneStore",
  "MovieRentalStore",
  "MusicStore",
  "OfficeEquipmentStore",
  "OutletStore",
  "PawnShop",
  "PetStore",
  "ShoeStore",
  "SportingGoodsStore",
  "TireShop",
  "ToyStore",
  "WholesaleStore",
  "TelevisionStation",
  "TouristInformationCenter",
  "TravelAgency"
]);

// A term definition: the IRI it maps to (null when the term is explicitly unmapped), whether it
// came from a simple string, and whether "@prefix": true marks it as a compact-IRI prefix.
type TermDefinition = { iri: string | null; simple: boolean; prefix: boolean };

// The parts of a JSON-LD active context that decide which IRI a @type expands to.
export type JsonLdTypeContext = {
  // False until a @context applies; without one, bare and "schema:" types are read as schema.org terms.
  declared: boolean;
  vocab: string | null;
  terms: Map<string, TermDefinition>;
};

export const noTypeContext: JsonLdTypeContext = { declared: false, vocab: null, terms: new Map() };

const schemaOrgRoot = "https://schema.org/";
const schemaOrgType = /^https?:\/\/(?:www\.)?schema\.org\/([A-Za-z]+)$/;
// Only an absolute URL names schema.org's context; "schema.org" alone is relative to the page.
const schemaOrgContext = /^https?:\/\/(?:www\.)?schema\.org(?:\/.*)?$/i;
const genDelimEnd = /[:/?#[\]@]$/;

function termDefinition(definition: unknown): TermDefinition | undefined {
  if (definition === null) {
    return { iri: null, simple: false, prefix: false };
  }

  if (typeof definition === "string") {
    return { iri: definition, simple: true, prefix: false };
  }

  if (definition && typeof definition === "object" && !Array.isArray(definition)) {
    const fields = definition as Record<string, unknown>;
    const id = fields["@id"];
    if (id === null || typeof id === "string") {
      return { iri: id, simple: false, prefix: fields["@prefix"] === true };
    }
  }

  return undefined;
}

// Expands a value that may be a term or a compact IRI using the context's terms. Terms already being
// expanded are tracked so a cyclic definition stops instead of recursing forever.
function expandIri(value: string, context: JsonLdTypeContext, expanding: ReadonlySet<string> = new Set()): string | undefined {
  const trimmed = value.trim();
  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    const prefix = trimmed.slice(0, colon);
    const suffix = trimmed.slice(colon + 1);
    if (suffix.startsWith("//")) {
      return trimmed;
    }

    // Follows JSON-LD 1.1: a term is a prefix when it has "@prefix": true, or when it is a simple string
    // term whose expanded IRI ends with a gen-delim character. Its IRI may itself be a term or compact IRI.
    const definition = context.terms.get(prefix);
    const base =
      definition?.iri && !expanding.has(prefix)
        ? expandIri(definition.iri, context, new Set([...expanding, prefix]))
        : undefined;
    if (base !== undefined && (definition?.prefix || (definition?.simple && genDelimEnd.test(base)))) {
      return base + suffix;
    }

    return !context.declared && prefix === "schema" ? schemaOrgRoot + suffix : trimmed;
  }

  if (context.terms.has(trimmed)) {
    const iri = context.terms.get(trimmed)?.iri;
    return iri && !expanding.has(trimmed) ? expandIri(iri, context, new Set([...expanding, trimmed])) : undefined;
  }

  if (!context.declared) {
    return schemaOrgRoot + trimmed;
  }

  return context.vocab ? context.vocab + trimmed : undefined;
}

// Applies a @context value (null, a URL, an object, or a list of them) in JSON-LD processing order.
export function applyTypeContext(active: JsonLdTypeContext, context: unknown): JsonLdTypeContext {
  if (context === undefined) {
    return active;
  }

  if (Array.isArray(context)) {
    return context.reduce<JsonLdTypeContext>(applyTypeContext, active);
  }

  // A null context removes everything inherited.
  if (context === null) {
    return { declared: true, vocab: null, terms: new Map() };
  }

  // schema.org's own context sets the schema.org vocabulary and "schema" prefix; any other remote
  // context is unknown and may redefine every term.
  if (typeof context === "string") {
    return schemaOrgContext.test(context.trim())
      ? {
          declared: true,
          vocab: schemaOrgRoot,
          terms: new Map([...active.terms, ["schema", { iri: schemaOrgRoot, simple: false, prefix: true }]])
        }
      : { declared: true, vocab: null, terms: new Map() };
  }

  if (typeof context !== "object") {
    return active;
  }

  const fields = context as Record<string, unknown>;
  const next: JsonLdTypeContext = { declared: true, vocab: active.vocab, terms: new Map(active.terms) };
  // As in JSON-LD context processing, @vocab is expanded with the terms defined before this context.
  if ("@vocab" in fields) {
    const vocab = fields["@vocab"];
    next.vocab = typeof vocab === "string" ? (expandIri(vocab, { ...active, declared: true }) ?? null) : null;
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith("@")) {
      const definition = termDefinition(value);
      if (definition) {
        next.terms.set(key, definition);
      }
    }
  }

  return next;
}

// Expands the type through its JSON-LD context and accepts schema.org LocalBusiness types, so
// "Dentist" under the schema.org context, "schema:Dentist" and "https://schema.org/Dentist" match,
// while "https://example.com/Restaurant" or a bare "Restaurant" under another vocabulary do not.
export function isLocalBusinessType(type: string, context: JsonLdTypeContext = noTypeContext): boolean {
  const name = schemaOrgType.exec(expandIri(type, context) ?? "")?.[1];
  return name !== undefined && (localBusinessTypes.has(name) || name.endsWith("LocalBusiness"));
}
