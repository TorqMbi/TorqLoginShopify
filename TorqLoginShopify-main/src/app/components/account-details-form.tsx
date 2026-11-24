"use client";

import { FormEvent, useState } from "react";

type Values = {
  contactPersonName: string;
  shopName: string;
  mobileNumber: string;
  contactMobileNumber: string;
  alternateMobileNumber: string;
  shopAddress: string;
  detailedAddress: string;
  city: string;
  province: string;
  comments: string;
};

const OTHER_CITY = "__other";

function initialCityChoice(city: string, cityNames: string[]): string {
  const key = city.trim().replace(/\s+/g, " ").toLowerCase();
  if (!key) return "";
  return cityNames.find((name) => name.toLowerCase() === key) ?? OTHER_CITY;
}

export function AccountDetailsForm({
  initialValues,
  completed,
  cityChoices = [],
  cityLocked = false,
}: {
  initialValues: Values;
  completed: boolean;
  // Cities from the City-wise Pricing Matrix in Shopify, by province.
  cityChoices?: Array<{ province: string; cities: string[] }>;
  cityLocked?: boolean;
}) {
  const cityNames = cityChoices.flatMap((group) => group.cities);
  const [cityChoice, setCityChoice] = useState(() => initialCityChoice(initialValues.city, cityNames));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    const data = Object.fromEntries(formData.entries());
    if (data.city === OTHER_CITY) data.city = data.cityOther ?? "";
    delete data.cityOther;
    const nextFieldErrors: Record<string, string> = {};
    for (const [field, label] of [
      ["contactPersonName", "Contact person name"],
      ["shopName", "Shop name"],
      ["shopAddress", "Shop address"],
      ["detailedAddress", "Detailed address"],
      ["city", "City"],
      ["province", "Province"],
    ]) {
      if (!String(data[field] ?? "").trim()) nextFieldErrors[field] = `${label} is required.`;
    }
    const contactDigits = String(data.contactMobileNumber ?? "").replace(/\D/g, "").replace(/^92/, "").replace(/^0/, "");
    if (!/^3\d{9}$/.test(contactDigits)) {
      nextFieldErrors.contactMobileNumber = "Enter a valid mobile number.";
    }
    const alternateValue = String(data.alternateMobileNumber ?? "");
    const alternateDigits = alternateValue.replace(/\D/g, "").replace(/^92/, "").replace(/^0/, "");
    if (alternateValue.trim() && !/^3\d{9}$/.test(alternateDigits)) {
      nextFieldErrors.alternateMobileNumber = "Enter a valid alternate number.";
    }
    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      return;
    }
    data.contactMobileNumber = `+92${contactDigits}`;
    data.alternateMobileNumber = alternateValue.trim() ? `+92${alternateDigits}` : "";
    setFieldErrors({});
    setBusy(true);
    try {
      const response = await fetch("/api/account/details", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save your details.");
      window.location.assign(completed ? "/dashboard" : "/login?registered=1");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save your details.");
    } finally {
      setBusy(false);
    }
  }

  function clearFieldError(field: string) {
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  function phoneDigits(value: string) {
    return value.replace(/\D/g, "").replace(/^92/, "").replace(/^0/, "");
  }

  return (
    <form className="form-stack details-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="contactPersonName">Contact person name <span className="details-required">*</span></label>
        <input id="contactPersonName" name="contactPersonName" maxLength={2000} required defaultValue={initialValues.contactPersonName} aria-invalid={Boolean(fieldErrors.contactPersonName)} aria-describedby={fieldErrors.contactPersonName ? "contactPersonName-error" : undefined} onChange={() => clearFieldError("contactPersonName")} />
        {fieldErrors.contactPersonName && <span className="field-error" id="contactPersonName-error">{fieldErrors.contactPersonName}</span>}
      </div>
      <div className="field">
        <label htmlFor="shopName">Shop name <span className="details-required">*</span></label>
        <input id="shopName" name="shopName" maxLength={2000} required defaultValue={initialValues.shopName} aria-invalid={Boolean(fieldErrors.shopName)} aria-describedby={fieldErrors.shopName ? "shopName-error" : undefined} onChange={() => clearFieldError("shopName")} />
        {fieldErrors.shopName && <span className="field-error" id="shopName-error">{fieldErrors.shopName}</span>}
      </div>
      <div className="field">
        <label htmlFor="contactMobileNumber">Mobile / WhatsApp number <span className="details-required">*</span></label>
        <div className={`signup-mobile-box${fieldErrors.contactMobileNumber ? " has-error" : ""}`}>
          <span className="signup-mobile-prefix" aria-hidden="true">+92</span>
          <input id="contactMobileNumber" name="contactMobileNumber" type="tel" autoComplete="tel" inputMode="numeric" maxLength={15} required defaultValue={phoneDigits(initialValues.contactMobileNumber)} placeholder="3XX XXXXXXX" aria-invalid={Boolean(fieldErrors.contactMobileNumber)} aria-describedby={fieldErrors.contactMobileNumber ? "contactMobileNumber-error" : "contactMobileNumber-hint"} onChange={() => clearFieldError("contactMobileNumber")} />
        </div>
        <span className="field-hint" id="contactMobileNumber-hint">We will contact you on this number.</span>
        {fieldErrors.contactMobileNumber && <span className="field-error" id="contactMobileNumber-error">{fieldErrors.contactMobileNumber}</span>}
      </div>
      <div className="field">
        <label htmlFor="alternateMobileNumber">Alternate number <span className="details-optional">(optional)</span></label>
        <div className={`signup-mobile-box${fieldErrors.alternateMobileNumber ? " has-error" : ""}`}>
          <span className="signup-mobile-prefix" aria-hidden="true">+92</span>
          <input id="alternateMobileNumber" name="alternateMobileNumber" type="tel" autoComplete="tel" inputMode="numeric" maxLength={15} placeholder="3XX XXXXXXX" defaultValue={phoneDigits(initialValues.alternateMobileNumber)} aria-invalid={Boolean(fieldErrors.alternateMobileNumber)} aria-describedby={fieldErrors.alternateMobileNumber ? "alternateMobileNumber-error" : undefined} onChange={() => clearFieldError("alternateMobileNumber")} />
        </div>
        {fieldErrors.alternateMobileNumber && <span className="field-error" id="alternateMobileNumber-error">{fieldErrors.alternateMobileNumber}</span>}
      </div>
      <div className="field">
        <label htmlFor="shopAddress">Shop address <span className="details-required">*</span></label>
        <input id="shopAddress" name="shopAddress" maxLength={2000} required defaultValue={initialValues.shopAddress} placeholder="Shop number, building or market" aria-invalid={Boolean(fieldErrors.shopAddress)} aria-describedby={fieldErrors.shopAddress ? "shopAddress-error" : undefined} onChange={() => clearFieldError("shopAddress")} />
        {fieldErrors.shopAddress && <span className="field-error" id="shopAddress-error">{fieldErrors.shopAddress}</span>}
      </div>
      <div className="field">
        <label htmlFor="detailedAddress">Detailed address <span className="details-required">*</span></label>
        <textarea id="detailedAddress" name="detailedAddress" maxLength={2000} required rows={3} defaultValue={initialValues.detailedAddress} placeholder="Street, area and nearby landmark" aria-invalid={Boolean(fieldErrors.detailedAddress)} aria-describedby={fieldErrors.detailedAddress ? "detailedAddress-error" : undefined} onChange={() => clearFieldError("detailedAddress")} />
        {fieldErrors.detailedAddress && <span className="field-error" id="detailedAddress-error">{fieldErrors.detailedAddress}</span>}
      </div>
      <div className="field">
        <label htmlFor="city">City <span className="details-required">*</span></label>
        {cityNames.length === 0 ? (
          <input id="city" name="city" maxLength={2000} required defaultValue={initialValues.city} placeholder="Lahore" aria-invalid={Boolean(fieldErrors.city)} aria-describedby={fieldErrors.city ? "city-error" : undefined} onChange={() => clearFieldError("city")} />
        ) : cityLocked ? (
          <>
            <input id="city" name="city" readOnly value={initialValues.city} aria-describedby="city-hint" />
            <span className="field-hint" id="city-hint">To change your city, contact us on WhatsApp.</span>
          </>
        ) : (
          <>
            <div className="province-select-wrap">
              <select id="city" name="city" required value={cityChoice} aria-invalid={Boolean(fieldErrors.city)} aria-describedby={fieldErrors.city ? "city-error" : "city-hint"} onChange={(event) => { setCityChoice(event.target.value); clearFieldError("city"); }}>
                <option value="" disabled>Select city</option>
                {cityChoices.map((group) => (
                  <optgroup key={group.province} label={group.province}>
                    {group.cities.map((name) => <option key={name} value={name}>{name}</option>)}
                  </optgroup>
                ))}
                <option value={OTHER_CITY}>Other city</option>
              </select>
            </div>
            {cityChoice === OTHER_CITY && (
              <input id="cityOther" name="cityOther" maxLength={2000} required defaultValue={initialCityChoice(initialValues.city, cityNames) === OTHER_CITY ? initialValues.city : ""} placeholder="Type your city" aria-label="Your city" aria-invalid={Boolean(fieldErrors.city)} onChange={() => clearFieldError("city")} />
            )}
            <span className="field-hint" id="city-hint">Choose the city your shop is in.</span>
          </>
        )}
        {fieldErrors.city && <span className="field-error" id="city-error">{fieldErrors.city}</span>}
      </div>
      <div className="field">
        <label htmlFor="province">Province <span className="details-required">*</span></label>
        <div className="province-select-wrap">
          <select id="province" name="province" required defaultValue={initialValues.province} aria-invalid={Boolean(fieldErrors.province)} aria-describedby={fieldErrors.province ? "province-error" : undefined} onChange={() => clearFieldError("province")}>
            <option value="" disabled>Select province</option>
            <option>Punjab</option>
            <option>Sindh</option>
            <option>Khyber Pakhtunkhwa</option>
            <option>Balochistan</option>
            <option>Islamabad Capital Territory</option>
            <option>Gilgit-Baltistan</option>
            <option>Azad Jammu and Kashmir</option>
          </select>
        </div>
        {fieldErrors.province && <span className="field-error" id="province-error">{fieldErrors.province}</span>}
      </div>
      <div className="field">
        <label htmlFor="comments">Comments <span className="details-optional">(optional)</span></label>
        <textarea id="comments" name="comments" maxLength={1000} rows={3} defaultValue={initialValues.comments} />
      </div>
      {error && <div className="message message-error" role="alert">{error}</div>}
      <button className="button" type="submit" disabled={busy}>
        {busy ? <><span className="signup-spinner" aria-hidden="true" />Submitting</> : completed ? "Save changes" : "Submit details"}
      </button>
    </form>
  );
}
