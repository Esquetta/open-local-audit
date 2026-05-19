import { describe, expect, it } from "vitest";
import { extractPublicContact } from "../src/contact.js";

describe("public contact extraction", () => {
  it("extracts public contact channels from website-derived HTML", () => {
    const contact = extractPublicContact(
      `
        <!doctype html>
        <html>
          <body>
            <a href="mailto:hello@localclinic.com">Email us</a>
            <a href="tel:+902120000000">Call</a>
            <a href="https://wa.me/902120000000">WhatsApp</a>
            <a href="/contact">Contact</a>
            <a href="https://www.instagram.com/localclinic">Instagram</a>
            <a href="https://www.facebook.com/localclinic">Facebook</a>
            <img src="/assets/email-info@example.com.png" alt="Icon">
          </body>
        </html>
      `,
      "https://localclinic.test/"
    );

    expect(contact).toEqual({
      publicEmail: "hello@localclinic.com",
      publicPhone: "+902120000000",
      whatsappUrl: "https://wa.me/902120000000",
      contactPageUrl: "https://localclinic.test/contact",
      socialProfiles: ["https://www.instagram.com/localclinic", "https://www.facebook.com/localclinic"],
      contactConfidence: "High",
      contactSource: "mailto, tel, whatsapp, contact-page, social"
    });
  });

  it("uses visible text email and marks partial signals as medium confidence", () => {
    const contact = extractPublicContact(
      `
        <html>
          <body>
            <p>For appointments write to booking@salon.test.</p>
            <a href="/iletisim">Iletisim</a>
          </body>
        </html>
      `,
      "https://salon.test/"
    );

    expect(contact.publicEmail).toBe("booking@salon.test");
    expect(contact.contactPageUrl).toBe("https://salon.test/iletisim");
    expect(contact.contactConfidence).toBe("Medium");
  });
});
