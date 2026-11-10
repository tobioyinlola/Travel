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
  proposal_sent: (v) => ({
    subject: `${v.advisorName} sent you a trip proposal`,
    text: `Hi ${v.name},\n\n${v.advisorName} has put together a trip proposal for you. Review it, ask for changes or approve it here:\n${v.url}\n\nThis link is personal to you; please do not forward it.`,
    sensitive: true,
  }),
  proposal_approved: (v) => ({
    subject: `Proposal approved: ${v.title}`,
    text: `Hi ${v.name},\n\n${v.decidedBy} approved your proposal. They can now complete the booking from the same link (details and payment). We will email you when it is confirmed.\nTrip: ${v.webBaseUrl}/trips/${v.tripId}`,
  }),
  proposal_changes_requested: (v) => ({
    subject: `Changes requested: ${v.title}`,
    text: `Hi ${v.name},\n\n${v.decidedBy} asked for changes:\n\n${v.note}\n\nUpdate the trip here: ${v.webBaseUrl}/trips/${v.tripId}`,
  }),
  proposal_declined: (v) => ({
    subject: `Proposal declined: ${v.title}`,
    text: `Hi ${v.name},\n\n${v.decidedBy} declined the proposal.${v.note ? `\n\nTheir note: ${v.note}` : ''}`,
  }),
  booking_confirmed_advisor: (v) => ({
    subject: `Booking confirmed: ${v.title}`,
    text: `Hi ${v.name},\n\nEvery hotel on "${v.title}" is confirmed for ${v.traveler}.\n\n${v.hotels}\n\nOpen the booking: ${v.webBaseUrl}/trips/${v.tripId}`,
  }),
  booking_failed_advisor: (v) => ({
    subject: `Booking failed: ${v.title}`,
    text: `Hi ${v.name},\n\nWe could not complete the booking for "${v.title}": ${v.reason}.\nAnything the traveler paid is being refunded. The trip is open for changes again, so you can update it and send a new proposal on the same link:\n${v.webBaseUrl}/trips/${v.tripId}`,
  }),
  booking_blocked_advisor: (v) => ({
    subject: `Your traveler could not check out: ${v.title}`,
    text: `Hi ${v.name},\n\nYour traveler tried to book "${v.title}" but could not go ahead: ${v.reason}\nUpdate the proposal and send it again:\n${v.webBaseUrl}/trips/${v.tripId}`,
  }),
  booking_cancelled_advisor: (v) => ({
    subject: `Booking cancelled: ${v.title}`,
    text: `Hi ${v.name},\n\nThe booking for "${v.title}" is cancelled. Supplier penalty: ${v.penalty}. Refund to the traveler: ${v.refund}.\n${v.webBaseUrl}/trips/${v.tripId}`,
  }),
  booking_confirmed_traveler: (v) => ({
    subject: `Your trip is booked: ${v.title}`,
    text: `Hi ${v.name},\n\nGood news: your trip "${v.title}" is confirmed.\n\n${v.hotels}\n\nKeep this email: the confirmation numbers are what the hotels will ask for. Questions? Reply to your advisor.`,
  }),
  booking_failed_traveler: (v) => ({
    subject: `We could not complete your booking: ${v.title}`,
    text: `Hi ${v.name},\n\nWe were not able to complete the booking for "${v.title}" (${v.reason}). Nothing is owed: anything you paid is being refunded to your card. Your advisor will be in touch with an updated proposal.`,
  }),
  booking_cancelled_traveler: (v) => ({
    subject: `Your booking is cancelled: ${v.title}`,
    text: `Hi ${v.name},\n\nYour booking for "${v.title}" has been cancelled.${v.penalty !== v.zero ? ` The hotels kept ${v.penalty} under their cancellation terms.` : ''} Refund to your card: ${v.refund}.`,
  }),
  booking_modified_traveler: (v) => ({
    subject: `Your booking details were updated: ${v.title}`,
    text: `Hi ${v.name},\n\nThe guest details on your booking for "${v.title}" were updated and the hotels have confirmed the change.`,
  }),
  booking_modification_failed_advisor: (v) => ({
    subject: `A hotel did not accept the change: ${v.title}`,
    text: `Hi ${v.name},\n\nThese hotels did not accept the updated guest details for "${v.title}": ${v.hotels}.\nPlease contact them directly; the booking itself is still confirmed.\n${v.webBaseUrl}/trips/${v.tripId}`,
  }),
  payout_paid_advisor: (v) => ({
    subject: `Your payout of ${v.net} is on its way`,
    text: `Hi ${v.name},\n\nWe have sent your payout: ${v.net}.\nCommission paid out: ${v.gross}${v.debt !== v.zero ? `\nDeducted for earlier cancelled bookings: ${v.debt}` : ''}\nSee the itemised statement: ${v.webBaseUrl}/earnings`,
  }),
  membership_renewal_upcoming: (v) => ({
    subject: `Your membership renews on ${v.endsAt}`,
    text: `Hi ${v.name},\n\nYour membership renews on ${v.endsAt} and we will charge ${v.amount} to your card on file. Update your card or cancel before then at ${v.webBaseUrl}/application`,
  }),
  membership_cancelled: (v) => ({
    subject: 'Your membership is cancelled',
    text: `Hi ${v.name},\n\nYour membership is cancelled and ends on ${v.endsAt}. Your open bookings stay serviceable.`,
  }),
};
