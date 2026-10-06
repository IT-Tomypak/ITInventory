// Organisation constants shown to people. One place, so the footer, the
// receipt and the refusal messages agree.
export const COMPANY = "Tomypak Flexible Packaging Sdn Bhd";
// Shown when the public form refuses a request (rate limit). Put the IT
// helpdesk extension or phone number here; leave "" to show no number.
export const IT_PHONE = "";
export const itContact = () => (IT_PHONE ? `the IT Department on ${IT_PHONE}` : "the IT Department");
