/**
 * Default CMS page drafts (markdown). Placeholders like {{business.name}} are resolved from
 * Settings when served. These are generic templates for an Indian food e-commerce business —
 * the admin marks them "Review before use" (isDefaultDraft) until the owner saves them.
 * They are not legal advice.
 */
const contactBlock = `**{{legal.legalName}}** ({{business.name}})
{{business.address}}
Phone / WhatsApp: {{business.phone}}
Email: {{business.email}}`;

const grievanceBlock = `## Grievance Officer
In accordance with the Information Technology Act, 2000, the Consumer Protection (E-Commerce) Rules, 2020 and the Digital Personal Data Protection Act, 2023, our Grievance Officer is:

- **Name:** {{legal.grievanceOfficer.name}}
- **Designation:** {{legal.grievanceOfficer.designation}}
- **Email:** {{legal.grievanceOfficer.email}}
- **Phone:** {{legal.grievanceOfficer.phone}}

We acknowledge complaints within 48 hours and aim to resolve them within one month of receipt.`;

const PAGES = {
  'privacy-policy': {
    title: 'Privacy Policy',
    content: `# Privacy Policy

This policy explains how {{legal.legalName}} ("{{business.name}}", "we", "us") collects and uses your personal data when you use {{site.url}} or order from us.

## What we collect
- **Contact details:** your name, mobile number and (optionally) email address.
- **Delivery details:** the delivery address you enter.
- **Order details:** items ordered, amounts and order history.
- **Payment details:** payments are processed by Razorpay. We do **not** store your card, UPI or bank details; we only receive a payment reference and status.
- **Device data:** basic technical data (browser type, IP address) and, if you allow it, a push-notification subscription.

## Why we use it
- To accept, prepare, deliver and support your orders (contract performance).
- To send order updates by SMS/WhatsApp/email/push.
- To meet legal obligations such as GST and accounting record-keeping.
- To prevent fraud and misuse of our services.

We do not sell your personal data. We do not send marketing messages without your consent.

## Who we share it with
Only with service providers needed to fulfil your order: payment gateway (Razorpay), delivery partners, email/SMS providers and our hosting providers — each only to the extent necessary.

## How long we keep it
Order and invoice records are kept for the period required by tax law (generally 8 years). You can ask us to delete your account; we will anonymise your personal data while retaining the legally required transaction records.

## Your rights
You may access, correct or request erasure of your personal data, or withdraw consent, by contacting us using the details below.

## Contact
${contactBlock}

${grievanceBlock}
`,
  },
  terms: {
    title: 'Terms & Conditions',
    content: `# Terms & Conditions

These terms apply to orders placed with {{legal.legalName}} ("{{business.name}}") through {{site.url}}.

## Products
Our sweets and snacks are freshly prepared food products. Images are indicative; actual products may vary slightly in appearance. Ingredients, allergens and shelf life are listed on each product page — please read them before ordering.

## Prices & payment
- All prices are in Indian Rupees (₹). Applicable taxes, delivery charges and any platform fee are shown before you pay.
- Orders are accepted on **prepaid** basis only (UPI, cards, net banking, wallets via Razorpay). Cash on delivery is not available.
- The minimum order value is ₹{{checkout.minOrderValue}}.
- An order is confirmed only after successful payment.

## Delivery
Delivery areas, charges and timelines are described in our Shipping Policy.

## Cancellations & refunds
Please see our Cancellation Policy and Refund Policy.

## Your account
Keep your login details and devices secure. You are responsible for orders placed from your account or device.

## Liability
To the extent permitted by law, our liability for any order is limited to the amount paid for that order.

## Governing law
These terms are governed by the laws of India. Courts at {{business.city}} shall have jurisdiction.

## Business details
${contactBlock}
GSTIN: {{legal.gstin}}
FSSAI Licence No.: {{legal.fssaiLicense}}

${grievanceBlock}
`,
  },
  'refund-policy': {
    title: 'Refund Policy',
    content: `# Refund Policy

Because our products are perishable food items, we cannot accept returns once an order has been delivered. We will, however, make things right if something goes wrong.

## When you are eligible for a refund
- The order was cancelled by us (for example, an item became unavailable).
- The order was cancelled by you within the cancellation window (see Cancellation Policy).
- The product delivered was damaged, spoiled or incorrect — please contact us **within 24 hours of delivery** with photos of the product and packaging.
- You were charged but the order was not confirmed (a failed or duplicate payment).

{{policies.returnNote}}

## How refunds are paid
- Refunds are made to the **original payment method** through Razorpay.
- Once initiated, refunds usually reach your account within 5–7 working days ({{policies.refundProcessingDays}} working days at most), depending on your bank.
- We may offer a partial refund where only part of the order was affected.

## Contact
${contactBlock}
`,
  },
  'shipping-policy': {
    title: 'Shipping & Delivery Policy',
    content: `# Shipping & Delivery Policy

## Where we deliver
We currently deliver within **{{business.city}}** and nearby serviceable pincodes. Enter your pincode at checkout to check availability.

## Delivery charges
Delivery charges depend on distance and are shown at checkout before payment. {{delivery.deliveryNote}}

## Delivery time
- Orders placed and paid before **{{delivery.sameDayCutoff}}** are usually delivered the same day; later orders are delivered on the next day.
- Delivery dates may change during festivals, bad weather or other circumstances beyond our control. We will inform you of any delay.

## At delivery
Please keep your phone reachable. If we cannot reach you or the address is incorrect, a re-delivery may be charged or the order may be cancelled as per our Cancellation Policy.

## Contact
${contactBlock}
`,
  },
  'cancellation-policy': {
    title: 'Cancellation Policy',
    content: `# Cancellation Policy

## Cancelling your order
You may cancel an order {{policies.cancellationWindow}}. Because our sweets are prepared fresh, orders that are already prepared or dispatched cannot be cancelled.

To cancel, call or WhatsApp us on {{business.phone}} with your order number.

## Cancellations by us
We may cancel an order if an item is unavailable, the address is not serviceable, or payment could not be verified. In such cases you receive a full refund to your original payment method.

## Refunds
Refunds for eligible cancellations are processed as described in our Refund Policy.

## Contact
${contactBlock}
`,
  },
  about: {
    title: 'About Us',
    content: `# About {{business.name}}

*{{business.tagline}}*

{{business.name}} has been serving traditional Indian sweets and snacks in {{business.city}}. Every sweet is prepared fresh in our own kitchen.

**Visit us:** {{business.address}}
**Opening hours:** {{business.openingHours}}
`,
  },
  contact: {
    title: 'Contact Us',
    content: `# Contact Us

${contactBlock}

**Opening hours:** {{business.openingHours}}
**Map:** {{business.mapUrl}}

${grievanceBlock}
`,
  },
};

module.exports = { PAGES };
