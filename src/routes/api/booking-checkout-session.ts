import { createFileRoute } from "@tanstack/react-router";

import { json } from "@/lib/auth.server";
import {
  attachBookingSession,
  BookingError,
  createPendingBooking,
} from "@/lib/bookings.server";
import { bookingSchema } from "@/lib/services.server";
import {
  createBookingCheckoutSession,
  getStripeSecretKey,
  StripeConfigError,
} from "@/lib/stripe.server";

export const Route = createFileRoute("/api/booking-checkout-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid request" }, { status: 400 });
        }

        const parsed = bookingSchema.safeParse(body);
        if (!parsed.success) {
          return json(
            { error: parsed.error.issues[0]?.message ?? "Invalid booking details" },
            { status: 400 },
          );
        }

        try {
          getStripeSecretKey();

          const { booking, price, serviceName } = await createPendingBooking(parsed.data);
          if (!(price > 0)) {
            return json(
              { error: "This service has no online price yet. Please contact the salon." },
              { status: 400 },
            );
          }

          const reference = booking["booking_reference"] as string;
          const session = await createBookingCheckoutSession({
            bookingId: booking["id"] as string,
            reference,
            email: parsed.data.email,
            serviceName,
            price,
            origin: new URL(request.url).origin,
          });

          await attachBookingSession(booking["id"] as string, session.id);

          if (!session.url) {
            return json({ error: "Could not start the payment session" }, { status: 502 });
          }
          return json({ url: session.url, booking_reference: reference }, { status: 201 });
        } catch (err) {
          if (err instanceof BookingError) {
            return json({ error: err.message }, { status: err.status });
          }
          if (err instanceof StripeConfigError) {
            console.error("stripe config", err.message);
            return json({ error: "Payments are not configured yet." }, { status: 503 });
          }
          console.error("booking checkout error", err);
          return json({ error: "Could not start checkout" }, { status: 500 });
        }
      },
    },
  },
});
