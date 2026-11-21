import { normalizeMobile } from "@/lib/validation";

export type CustomerShopDetails = {
  contactPersonName: string;
  shopName: string;
  contactMobileNumber: string;
  alternateMobileNumber: string;
  shopAddress: string;
  detailedAddress: string;
  city: string;
  province: string;
  comments: string;
};

const requiredFields = [
  ["contactPersonName", "Contact person name"],
  ["shopName", "Shop name"],
  ["contactMobileNumber", "Mobile / WhatsApp number"],
  ["shopAddress", "Shop address"],
  ["detailedAddress", "Detailed address"],
  ["city", "City"],
  ["province", "Province"],
] as const;

const allowedProvinces = new Set([
  "Punjab",
  "Sindh",
  "Khyber Pakhtunkhwa",
  "Balochistan",
  "Islamabad Capital Territory",
  "Gilgit-Baltistan",
  "Azad Jammu and Kashmir",
]);

export function parseCustomerShopDetails(
  body: Record<string, unknown>,
): { details: CustomerShopDetails } | { error: string } {
  const details: CustomerShopDetails = {
    contactPersonName: "",
    shopName: "",
    contactMobileNumber: "",
    alternateMobileNumber: "",
    shopAddress: "",
    detailedAddress: "",
    city: "",
    province: "",
    comments: "",
  };

  for (const [field, label] of requiredFields) {
    const value = typeof body[field] === "string" ? body[field].trim() : "";
    if (!value || value.length > 2000) {
      return { error: `${label} is required and must be 2,000 characters or fewer.` };
    }
    details[field] = value;
  }

  if (!allowedProvinces.has(details.province)) {
    return { error: "Select a valid province." };
  }

  const contactMobileNumber = normalizeMobile(details.contactMobileNumber);
  if (!contactMobileNumber) {
    return { error: "Enter a valid mobile / WhatsApp number with its country code." };
  }
  details.contactMobileNumber = contactMobileNumber;

  const alternateValue =
    typeof body.alternateMobileNumber === "string" ? body.alternateMobileNumber.trim() : "";
  const alternateMobileNumber = alternateValue ? normalizeMobile(alternateValue) : null;
  if (alternateValue && !alternateMobileNumber) {
    return { error: "Enter a valid alternate number with its country code." };
  }
  details.alternateMobileNumber = alternateMobileNumber ?? "";

  const comments = typeof body.comments === "string" ? body.comments.trim() : "";
  if (comments.length > 1000) {
    return { error: "Comments must be 1,000 characters or fewer." };
  }
  details.comments = comments;

  return { details };
}
