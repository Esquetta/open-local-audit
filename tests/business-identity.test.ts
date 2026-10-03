import { describe, expect, it } from "vitest";
import { compareBusinessIdentity, extractBusinessIdentities } from "../src/business-identity.js";

const candidate = ({ label = "Mavi Dental Clinic", ...overrides }: Record<string, unknown> = {}) => ({
  label: typeof label === "string" ? label : undefined,
  sourceMetadata: {
    phones: ["0212 555 00 00"],
    address: "Ataturk Cad. 12",
    locality: "Istanbul",
    country: "TR",
    ...overrides
  }
});

function businessJson(values: Record<string, unknown>): string {
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Dentist", ...values })}</script>`;
}

describe("business identity evidence", () => {
  it("matches structured identities despite international phone and formatting differences", () => {
    const fixtures = [
      ["TR", "0212 555 00 00", "+90 (212) 555 00 00", "Istanbul"],
      ["US", "(212) 555-0100", "+1 212 555 0100", "New York"],
      ["DE", "030 123456", "+49 30 123456", "Berlin"],
      ["GB", "020 7946 0958", "+44 20 7946 0958", "London"]
    ] as const;

    for (const [country, sourcePhone, websitePhone, locality] of fixtures) {
      const observations = extractBusinessIdentities(
        businessJson({ name: "Mavi Dental Clinic", telephone: websitePhone, address: { streetAddress: "Atatürk Cad. 12", addressLocality: locality, addressCountry: country } }),
        "https://mavi.example/contact"
      );
      expect(compareBusinessIdentity(candidate({ phones: [sourcePhone], locality, country }), observations).status).toBe("matched");
    }
  });

  it("reports a clearly different structured business as a conflict", () => {
    const observations = extractBusinessIdentities(
      `<title>Kirmizi Restaurant</title>${businessJson({ name: "Kirmizi Restaurant", telephone: "+90 212 444 11 22", address: { streetAddress: "Cumhuriyet Cad. 99", addressLocality: "Ankara", addressCountry: "TR" } })}`,
      "https://wrong.example/"
    );
    expect(compareBusinessIdentity(candidate(), observations)).toMatchObject({ status: "conflict" });
  });

  it("does not certify the same brand at a different branch", () => {
    const observations = extractBusinessIdentities(
      businessJson({ name: "Mavi Dental Clinic", telephone: "+90 212 555 99 99", address: { streetAddress: "Bagdat Cad. 88", addressLocality: "Istanbul", addressCountry: "TR" } }),
      "https://mavi.example/kadikoy"
    );
    expect(compareBusinessIdentity(candidate(), observations)).toMatchObject({ status: "conflict" });
  });

  it("keeps missing data and a single disagreement uncertain", () => {
    expect(compareBusinessIdentity(candidate(), [])).toMatchObject({ status: "uncertain" });
    const observations = extractBusinessIdentities(businessJson({ name: "Mavi Dental Clinic", telephone: "+90 212 555 99 99" }), "https://mavi.example/");
    expect(compareBusinessIdentity(candidate({ address: undefined, locality: undefined }), observations)).toMatchObject({ status: "uncertain" });
  });

  it("does not combine or trust third-party schema branches", () => {
    const html = [
      businessJson({ name: "Mavi Dental Clinic", telephone: "+90 212 555 00 00", address: { streetAddress: "Ataturk Cad. 12", addressLocality: "Istanbul", addressCountry: "TR" } }),
      '<script type="application/ld+json">{"@type":"Person","name":"Mavi Dental Clinic","telephone":"+902125550000"}</script>',
      '<script type="application/ld+json">{"@type":"Organization","name":"Publisher","url":"https://publisher.example","telephone":"+902125550000"}</script>'
    ].join("");
    const observations = extractBusinessIdentities(html, "https://mavi.example/");
    expect(observations).toHaveLength(1);
    const result = compareBusinessIdentity(candidate(), observations);
    expect(result.status).toBe("matched");
    expect(result.evidence.find((item) => item.field === "phone")?.state).toBe("match");
  });

  it("keeps a matching homepage and conflicting contact-page entity uncertain", () => {
    const observations = extractBusinessIdentities([
      businessJson({ name: "Mavi Dental Clinic", telephone: "+90 212 555 00 00", address: { streetAddress: "Ataturk Cad. 12", addressLocality: "Istanbul", addressCountry: "TR" } }),
      businessJson({ name: "Mavi Dental Clinic", telephone: "+90 212 555 99 99", address: { streetAddress: "Bagdat Cad. 88", addressLocality: "Istanbul", addressCountry: "TR" } })
    ].join(""), "https://mavi.example/");
    const result = compareBusinessIdentity(candidate(), observations);
    expect(result.status).toBe("uncertain");
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons.join(" ")).toMatch(/agrees on|differs on/);
  });

  it("ignores malformed and excessively nested JSON-LD without creating identities", () => {
    const tooDeep = JSON.stringify({ "@graph": { "@graph": { "@graph": { "@graph": { "@graph": { "@graph": { "@graph": { "@graph": { "@type": "Dentist", name: "Mavi Dental Clinic" } } } } } } } } });
    const observations = extractBusinessIdentities(`<script type="application/ld+json">{bad json}</script><script type="application/ld+json">${tooDeep}</script>`, "https://mavi.example/");
    expect(observations).toEqual([]);
  });

  it("treats a matching page title as weak, non-decisive evidence", () => {
    const observations = extractBusinessIdentities("<title>Mavi Dental Clinic</title><meta property=\"og:site_name\" content=\"Mavi Dental Clinic\">", "https://mavi.example/");
    const result = compareBusinessIdentity(candidate(), observations);
    expect(result.status).toBe("uncertain");
    expect(result.evidence.some((item) => item.state === "ambiguous")).toBe(true);
  });

  it("uses the source country for a website national phone without schema country", () => {
    const observations = extractBusinessIdentities(
      businessJson({ name: "Mavi Dental Clinic", telephone: "0212 555 00 00", address: { streetAddress: "Ataturk Cad. 12", addressLocality: "Istanbul" } }),
      "https://mavi.example/"
    );
    const result = compareBusinessIdentity(candidate(), observations);
    expect(result.status).toBe("matched");
    expect(result.evidence.find((item) => item.field === "phone")?.state).toBe("match");
  });

  it("does not treat an embedded phone sentence as valid phone evidence", () => {
    const observations = extractBusinessIdentities(businessJson({ name: "Diş Kliniği", telephone: "Call us on +90 212 555 00 00 today" }), "https://mavi.example/");
    const result = compareBusinessIdentity(candidate({ phones: ["0212 555 00 00"], address: undefined, locality: undefined, label: undefined }), observations);
    expect(result.status).toBe("uncertain");
    expect(result.evidence.find((item) => item.field === "phone")?.state).toBe("missing");
  });

  it("keeps a street abbreviation plus a changed phone uncertain", () => {
    const observations = extractBusinessIdentities(
      businessJson({ name: "Mavi Dental Clinic", telephone: "+90 212 555 99 99", address: { streetAddress: "10 Main St", addressLocality: "Istanbul", addressCountry: "TR" } }),
      "https://mavi.example/"
    );
    const result = compareBusinessIdentity(candidate({ address: "10 Main Street" }), observations);
    expect(result.status).toBe("uncertain");
    expect(result.evidence.find((item) => item.field === "address")?.state).toBe("match");
  });

  it("identifies distinct numbered streets in the same locality", () => {
    const observations = extractBusinessIdentities(
      businessJson({ name: "Mavi Dental Clinic", telephone: "+90 212 555 00 00", address: { streetAddress: "88 Bagdat Cad.", addressLocality: "Istanbul", addressCountry: "TR" } }),
      "https://mavi.example/"
    );
    const result = compareBusinessIdentity(candidate({ address: "12 Ataturk Cad." }), observations);
    expect(result.evidence.find((item) => item.field === "address")?.state).toBe("different");
  });

  it("does not count a generic multilingual industry label as name agreement", () => {
    const observations = extractBusinessIdentities(businessJson({ name: "dis klinigi", telephone: "+90 212 555 00 00" }), "https://mavi.example/");
    const result = compareBusinessIdentity(candidate({ address: undefined, locality: undefined, label: "Diş Kliniği" }), observations);
    expect(result.status).toBe("uncertain");
    expect(result.evidence.find((item) => item.field === "name")?.state).toBe("ambiguous");
  });

  it("accepts schema URL types and same-host URL variants without trusting other hosts", () => {
    const observations = extractBusinessIdentities([
      businessJson({ "@type": "https://schema.org/ExerciseGym", name: "Mavi Gym", url: "http://www.mavi.example/" }),
      businessJson({ "@type": "https://schema.org/HairSalon", name: "External Salon", url: "https://publisher.example/" })
    ].join(""), "https://mavi.example/");
    expect(observations).toMatchObject([{ kind: "structured", name: "Mavi Gym" }]);
  });

  it("accepts UK aliases and leaves unsupported countries non-decisive", () => {
    const uk = extractBusinessIdentities(businessJson({ name: "Mavi Dental Clinic", telephone: "020 7946 0958", address: { streetAddress: "10 Main Street", addressLocality: "London", addressCountry: "UK" } }), "https://mavi.example/");
    expect(compareBusinessIdentity(candidate({ phones: ["020 7946 0958"], address: "10 Main Street", locality: "London", country: "GB" }), uk).status).toBe("matched");
    const unknown = extractBusinessIdentities(businessJson({ name: "Mavi Dental Clinic", telephone: "+90 212 555 00 00", address: { streetAddress: "Ataturk Cad. 12", addressLocality: "Istanbul", addressCountry: "US" } }), "https://mavi.example/");
    expect(compareBusinessIdentity(candidate({ country: "ZZ" }), unknown).evidence.find((item) => item.field === "address")?.state).toBe("match");
  });
});
