/**
 * Message templates (FR-NTF-01). Plain text for now; branded HTML and localisation are FR-NTF-04 (V1).
 * `sensitive` templates are never stored with their body.
 */
export interface Rendered {
  subject: string;
  text: string;
  sensitive?: boolean;
}

type Vars = Record<string, string>;

export const templates: Record<string, (v: Vars) => Rendered> = {
  verification_code: (v) => ({
    subject: 'Your verification code',
    text: `Your Advisor Travel Platform code is ${v.code}. It expires in 10 minutes. If you did not ask for it, ignore this message.`,
    sensitive: true,
  }),
  application_received: (v) => ({
    subject: 'We received your application',
    text: `Hi ${v.name},\n\nThanks for applying. Next: verify your identity and sign the contractor agreement from your application page:\n${v.webBaseUrl}/application\n\nWe review applications once both are done.`,
  }),
  application_info_requested: (v) => ({
    subject: 'We need a bit more information',
    text: `Hi ${v.name},\n\nOur review team needs more information:\n\n${v.note}\n\nUpdate your application here: ${v.webBaseUrl}/application`,
  }),
  application_rejected: (v) => ({
    subject: 'Your application',
    text: `Hi ${v.name},\n\nThank you for applying. We are not able to accept your application at this time.`,
  }),
  application_accepted: (v) => ({
    subject: 'Your application is accepted',
    text: `Hi ${v.name},\n\nGood news: your application is accepted. We are now taking your membership payment; you will get a receipt when it goes through.`,
  }),
  advisor_approved: (v) => ({
    subject: 'Welcome aboard',
    text: `Hi ${v.name},\n\nYour membership is active. Complete the Essentials course to unlock booking:\n${v.webBaseUrl}/learn`,
  }),
  membership_receipt: (v) => ({
    subject: `Receipt for your membership (${v.total})`,
    text: `Hi ${v.name},\n\nWe received your membership payment of ${v.total}. Your invoices are in your account.`,
  }),
  membership_payment_failed: (v) => ({
    subject: 'Your membership payment did not go through',
    text: `Hi ${v.name},\n\nWe could not take your membership payment (${v.reason}). Update your card here: ${v.webBaseUrl}/membership`,
  }),
  membership_cancelled: (v) => ({
    subject: 'Your membership is cancelled',
    text: `Hi ${v.name},\n\nYour membership is cancelled and ends on ${v.endsAt}. Your open bookings stay serviceable.`,
  }),
};
