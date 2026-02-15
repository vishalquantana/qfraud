/**
 * State-mandated fraud warning text for DOI fraud referral reports.
 * Maps state abbreviations to required fraud warning language.
 */

const STATE_FRAUD_WARNINGS: Record<string, string> = {
  AL: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or who knowingly presents false information in an application for insurance is guilty of a crime and may be subject to restitution fines or confinement in prison, or any combination thereof.",
  AZ: "For your protection, Arizona law requires the following statement to appear on this form. Any person who knowingly presents a false or fraudulent claim for payment of a loss is subject to criminal prosecution and civil penalties.",
  AR: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or knowingly presents false information in an application for insurance is guilty of a crime and may be subject to fines and confinement in prison.",
  CA: "For your protection, California law requires the following to appear on this form: Any person who knowingly presents a false or fraudulent claim for the payment of a loss is guilty of a crime and may be subject to fines and confinement in state prison.",
  CO: "It is unlawful to knowingly provide false, incomplete, or misleading facts or information to an insurance company for the purpose of defrauding or attempting to defraud the company. Penalties may include imprisonment, fines, denial of insurance, and civil damages.",
  CT: "This form is approved by the Connecticut Insurance Department.",
  DE: "Any person who knowingly, and with intent to injure, defraud or deceive any insurer, files a statement of claim containing any false, incomplete or misleading information is guilty of a felony.",
  DC: "WARNING: It is a crime to provide false or misleading information to an insurer for the purpose of defrauding the insurer or any other person. Penalties include imprisonment and/or fines.",
  FL: "Any person who knowingly and with intent to injure, defraud, or deceive any insurer files a statement of claim or an application containing any false, incomplete, or misleading information is guilty of a felony of the third degree.",
  GA: "Any person who knowingly and with intent to defraud any insurance company or other person files an application for insurance or statement of claim containing any materially false information or conceals for the purpose of misleading, information concerning any fact material thereto commits a fraudulent insurance act, which is a crime and subjects such person to criminal and civil penalties.",
  HI: "For your protection, Hawaii law requires you to be informed that presenting a fraudulent claim for payment of a loss or benefit is a crime punishable by fines or imprisonment, or both.",
  ID: "Any person who knowingly, and with intent to defraud or deceive any insurance company, files a statement containing any false, incomplete, or misleading information is guilty of a felony.",
  IL: "A person who knowingly makes a false or fraudulent statement in an insurance application, claim, or report commits insurance fraud, a Class A misdemeanor. A second or subsequent offense is a Class 3 felony.",
  IN: "A person who knowingly and with intent to defraud an insurer files a statement of claim containing any false, incomplete, or misleading information commits a felony.",
  KS: "Any person who knowingly presents false information in an application for insurance may be guilty of insurance fraud as determined by a court of law.",
  KY: "Any person who knowingly and with intent to defraud any insurance company or other person files a statement of claim containing any materially false information or conceals, for the purpose of misleading, information concerning any fact material thereto commits a fraudulent insurance act, which is a crime.",
  LA: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or knowingly presents false information in an application for insurance is guilty of a crime and may be subject to fines and confinement in prison.",
  ME: "It is a crime to knowingly provide false, incomplete, or misleading information to an insurance company for the purpose of defrauding the company. Penalties may include imprisonment, fines, or a denial of insurance benefits.",
  MD: "Any person who knowingly and willfully presents a false or fraudulent claim for payment of a loss or benefit or who knowingly and willfully presents false information in an application for insurance is guilty of a crime and may be subject to fines and confinement in prison.",
  MA: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or who knowingly presents false information in an application for insurance is guilty of a crime and may be subject to fines and confinement in prison.",
  MI: "Any person who knowingly and with intent to defraud any insurance company or another person, files a statement of claim containing any false, incomplete, or misleading information is committing an insurance fraud which is a crime.",
  MN: "A person who files a claim with intent to defraud or helps commit a fraud against an insurer is guilty of a crime.",
  MS: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit is subject to criminal and civil penalties.",
  MO: "Any person who knowingly presents a false or fraudulent claim for payment of a loss is guilty of a crime and may be subject to fines and confinement in prison.",
  MT: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or who knowingly presents false information in an application for insurance is guilty of a crime and may be subject to fines and confinement in prison.",
  NE: "Any person who knowingly and with intent to defraud any insurance company or other person files a claim containing any materially false information subjects themselves to criminal and civil penalties.",
  NV: "Pursuant to NRS 686A.291, any person who knowingly provides false, incomplete, or misleading information to an insurance company may be subject to criminal penalties.",
  NH: "Any person who, with a purpose to injure, defraud, or deceive any insurance company, files a statement of claim containing any false, incomplete, or misleading information is subject to prosecution and punishment for insurance fraud.",
  NJ: "Any person who includes any false or misleading information on an application for an insurance policy is subject to criminal and civil penalties.",
  NM: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or knowingly presents false information in an application for insurance is guilty of a crime and may be subject to civil fines and criminal penalties.",
  NY: "Any person who knowingly and with intent to defraud any insurance company or other person files an application for insurance or statement of claim containing any materially false information, or conceals for the purpose of misleading, information concerning any fact material thereto, commits a fraudulent insurance act, which is a crime, and shall also be subject to a civil penalty not to exceed five thousand dollars and the stated value of the claim for each such violation.",
  NC: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or who knowingly presents false information in an application for insurance is guilty of a crime and may be subject to fines and confinement in prison.",
  ND: "Any person who knowingly presents a false or fraudulent claim for payment of a loss is guilty of insurance fraud.",
  OH: "Any person who, with intent to defraud or knowing that he is facilitating a fraud against an insurer, submits an application or files a claim containing a false or deceptive statement is guilty of insurance fraud.",
  OK: "WARNING: Any person who knowingly, and with intent to injure, defraud or deceive any insurer, makes any claim for the proceeds of an insurance policy containing any false, incomplete or misleading information is guilty of a felony.",
  OR: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or who knowingly presents false information in an application for insurance may be guilty of a crime and may be subject to fines and confinement in prison.",
  PA: "Any person who knowingly and with intent to defraud any insurance company or other person files an application for insurance or statement of claim containing any materially false information or conceals for the purpose of misleading, information concerning any fact material thereto commits a fraudulent insurance act, which is a crime and subjects such person to criminal and civil penalties.",
  RI: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or knowingly presents false information in an application for insurance is guilty of a crime and may be subject to fines and confinement in prison.",
  SC: "Any person who knowingly presents a false or fraudulent claim for payment of a loss is subject to criminal and civil penalties.",
  SD: "Any person who knowingly files a statement of claim containing any false, incomplete, or misleading information is subject to criminal and civil penalties.",
  TN: "It is a crime to knowingly provide false, incomplete, or misleading information to an insurance company for the purpose of defrauding the company. Penalties include imprisonment, fines, and denial of insurance benefits.",
  TX: "Any person who knowingly presents a false or fraudulent claim for the payment of a loss is guilty of a crime and may be subject to fines and confinement in state prison.",
  UT: "Any person who knowingly presents false or fraudulent underwriting information, files or causes to be filed a false or fraudulent claim for disability compensation or medical benefits, or submits a false or fraudulent report or billing for health care fees or other professional services is guilty of a crime and may be subject to fines and confinement in state prison.",
  VT: "Any person who knowingly presents a false statement in an application for insurance may be guilty of a criminal offense and subject to penalties under state law.",
  VA: "It is a crime to knowingly provide false, incomplete, or misleading information to an insurance company for the purpose of defrauding the company. Penalties include imprisonment, fines, and denial of insurance benefits.",
  WA: "It is a crime to knowingly provide false, incomplete, or misleading information to an insurance company for the purpose of defrauding the company. Penalties include imprisonment, fines, and denial of insurance benefits.",
  WV: "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or knowingly presents false information in an application for insurance is guilty of a crime and may be subject to fines and confinement in prison.",
  WI: "Any person who knowingly makes or aids in the transaction of a fraudulent insurance act is guilty of a crime.",
  WY: "Any person who knowingly presents a false or fraudulent claim for payment of a loss is guilty of insurance fraud and may be subject to fines and confinement in prison.",
};

const DEFAULT_FRAUD_WARNING =
  "Any person who knowingly presents a false or fraudulent claim for payment of a loss or benefit or who knowingly presents false information in an application for insurance is guilty of a crime and may be subject to fines, restitution, or confinement in prison, or any combination thereof.";

/**
 * Get the state fraud warning text for a given state code.
 * Falls back to a generic warning if state is not found.
 */
export function getStateFraudWarning(stateCode: string | null): string {
  if (!stateCode) return DEFAULT_FRAUD_WARNING;
  const code = stateCode.trim().toUpperCase();
  return STATE_FRAUD_WARNINGS[code] ?? DEFAULT_FRAUD_WARNING;
}

/**
 * Extract state code from an address string.
 * Looks for 2-letter state abbreviation patterns.
 */
export function extractStateFromAddress(address: string | null): string | null {
  if (!address) return null;

  // Common US state abbreviation codes
  const stateCodes = new Set(Object.keys(STATE_FRAUD_WARNINGS));

  // Try to find a 2-letter state code in the address
  // Pattern: comma/space followed by 2 capital letters, then space/zip/end
  const match = address.match(/[,\s]\s*([A-Z]{2})\s+\d{5}/);
  if (match && stateCodes.has(match[1])) {
    return match[1];
  }

  // Fallback: look for any 2-letter state code surrounded by word boundaries
  const words = address.toUpperCase().split(/[\s,]+/);
  for (const word of words) {
    if (stateCodes.has(word)) {
      return word;
    }
  }

  return null;
}
