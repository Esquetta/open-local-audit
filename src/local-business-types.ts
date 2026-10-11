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

// The parts of a JSON-LD active context that decide which IRI a @type expands to.
export type JsonLdTypeContext = {
  // False until a @context applies; without one, bare and "schema:" types are read as schema.org terms.
  declared: boolean;
  vocab: string | null;
  terms: Map<string, string | null>;
};

export const noTypeContext: JsonLdTypeContext = { declared: false, vocab: null, terms: new Map() };

const schemaOrgRoot = "https://schema.org/";
const schemaOrgType = /^https?:\/\/(?:www\.)?schema\.org\/([A-Za-z]+)$/;
const schemaOrgContext = /^(?:https?:\/\/)?(?:www\.)?schema\.org(?:\/.*)?$/i;

function termIri(definition: unknown): string | null | undefined {
  if (definition === null || typeof definition === "string") {
    return definition;
  }

  if (definition && typeof definition === "object" && !Array.isArray(definition)) {
    const id = (definition as Record<string, unknown>)["@id"];
    return id === null || typeof id === "string" ? id : undefined;
  }

  return undefined;
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
      ? { declared: true, vocab: schemaOrgRoot, terms: new Map([...active.terms, ["schema", schemaOrgRoot]]) }
      : { declared: true, vocab: null, terms: new Map() };
  }

  if (typeof context !== "object") {
    return active;
  }

  const next: JsonLdTypeContext = { declared: true, vocab: active.vocab, terms: new Map(active.terms) };
  for (const [key, definition] of Object.entries(context)) {
    if (key === "@vocab") {
      next.vocab = typeof definition === "string" ? definition : null;
    } else if (!key.startsWith("@")) {
      const iri = termIri(definition);
      if (iri !== undefined) {
        next.terms.set(key, iri);
      }
    }
  }

  return next;
}

function expandType(type: string, context: JsonLdTypeContext, depth = 0): string | undefined {
  const value = type.trim();
  const colon = value.indexOf(":");
  if (colon > 0) {
    const prefix = value.slice(0, colon);
    const suffix = value.slice(colon + 1);
    if (suffix.startsWith("//")) {
      return value;
    }

    if (context.terms.has(prefix)) {
      const base = context.terms.get(prefix);
      return base ? base + suffix : undefined;
    }

    return !context.declared && prefix === "schema" ? schemaOrgRoot + suffix : value;
  }

  if (context.terms.has(value)) {
    const iri = context.terms.get(value);
    return iri && depth < 3 ? expandType(iri, context, depth + 1) : undefined;
  }

  if (!context.declared) {
    return schemaOrgRoot + value;
  }

  return context.vocab ? context.vocab + value : undefined;
}

// Expands the type through its JSON-LD context and accepts schema.org LocalBusiness types, so
// "Dentist" under the schema.org context, "schema:Dentist" and "https://schema.org/Dentist" match,
// while "https://example.com/Restaurant" or a bare "Restaurant" under another vocabulary do not.
export function isLocalBusinessType(type: string, context: JsonLdTypeContext = noTypeContext): boolean {
  const name = schemaOrgType.exec(expandType(type, context) ?? "")?.[1];
  return name !== undefined && (localBusinessTypes.has(name) || name.endsWith("LocalBusiness"));
}
