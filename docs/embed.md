# Adding the DentBook booking form to your website

The booking form lets clients book a visit on your website. They choose a service and a free
time, confirm their phone with an SMS code, and they're booked. The visit appears in your
DentBook journal, and the dentist gets a Telegram alert.

Setup takes about five minutes and doesn't need a developer.

## 1. Create a key for your website

1. Sign in to your DentBook panel as the owner or an administrator.
2. Open **Website**.
3. Press **New key**, give it a name, and under **Websites** list every address your website
   opens from, one per line. Include the scheme and leave out the path:

   ```
   https://www.your-clinic.com
   https://your-clinic.com
   ```

   The form only works on the addresses you list. If your site opens both with and without
   `www`, add both.

4. Under **How the form appears**, choose:
   - **On the page** — the form sits right where you paste the code, for example on a
     "Book a visit" page.
   - **In a popup, on a button click** — the form opens over the page when a client clicks
     one of your own buttons or links. See [Booking form in a popup](#booking-form-in-a-popup).

   You can change this later on the same page. Then press **Create key**.

## 2. Copy the embed code

On the same page, press **Copy code**. For a form on the page, it looks like this:

```html
<div id="dentbook-booking"></div>
<script
  src="https://dentbook.example.com/widget/dentbook-widget.js"
  data-key="pk_…"
  data-target="#dentbook-booking"
  async
></script>
```

## 3. Paste it where the form should appear

- **Plain HTML site:** paste the code where the form should be, for example in the content
  of a "Book a visit" page.
- **WordPress:** edit the page, add a **Custom HTML** block and paste the code into it. With
  the classic editor, switch to the **Text** tab before pasting.
- **Squarespace:** add a **Code** block, choose HTML and paste.
- **Wix:** add **Embed Code → Embed HTML** and paste. Wix shows embedded code inside a frame
  on its own address. If the form says online booking isn't available, preview the page,
  find the frame's address (it ends in `filesusr.com`), and add it to the key's addresses
  as well.
- **Other builders:** look for "custom code", "HTML block" or "embed". The code must run as
  HTML, not as text.

Publish the page and open it. The form should show your services.

## Booking form in a popup

Choose this when you want "Book a visit" buttons across your site, for example in the
header, on service pages and in the footer, instead of a separate booking page.

1. On **Website**, set the key's **How the form appears** to **In a popup, on a button
   click** and press **Copy code**. The code is a single line:

   ```html
   <script
     src="https://dentbook.example.com/widget/dentbook-widget.js"
     data-key="pk_…"
     data-mode="popup"
     async
   ></script>
   ```

2. Paste it **once**, so that it is on every page with booking buttons: into your site's
   footer, or just before `</body>`. In WordPress, use a "header and footer code" plugin or
   the theme's footer settings. Most builders have a "custom code" setting for the whole
   site.
3. Add the class `dentbook-open` to every button or link that should open the form:

   ```html
   <a href="#" class="dentbook-open">Book a visit</a>
   <button type="button" class="btn btn-primary dentbook-open">Book online</button>
   ```

   Keep the button's own classes; just add `dentbook-open` next to them. In most builders the
   field is called "CSS class" or "Additional CSS classes".

A click on any of them opens the form over the page. The client can close it with the ×
button, the Esc key, or a click outside. If they close it halfway, it opens on the same step
the next time. On phones, the form takes the whole screen.

The same key can show the form on one page and in a popup on others: use the page code on
your booking page and the popup code everywhere else. Changing **How the form appears**
only changes the code the panel shows; code that is already on your site keeps working as
it is.

## Options

Set these on the `<script>` tag:

| Attribute      | What it does                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `data-key`     | Your key. Required.                                                                                           |
| `data-target`  | Where the form goes, as a CSS selector. Without it, the form appears right after the script.                  |
| `data-mode`    | `popup` opens the form in a popup from buttons on your site. Without it, the form sits on the page.           |
| `data-trigger` | Which elements open the popup, as a CSS selector, for example `.book-now`. Without it, `.dentbook-open` does. |
| `data-locale`  | Form language: `en`, `ru` or `hy`. Without it, the language set in **Settings** is used.                      |

The form sits in its own isolated area, so your site's styles don't change it and it doesn't
change your site.

## If your site uses a Content Security Policy

Most sites don't. If yours sends a `Content-Security-Policy` header, allow the platform
domain and Cloudflare's captcha:

```
script-src  https://dentbook.example.com https://challenges.cloudflare.com;
connect-src https://dentbook.example.com;
frame-src   https://challenges.cloudflare.com;
```

## Troubleshooting

Clients never see technical details. Whenever the form can't work, it says "Online booking is
not available right now. Please call the clinic." The usual causes:

| Cause                                   | What to do                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| The site's address isn't on the key     | Add the exact address the page opens from: with or without `www`, `https`. This is the most common cause. |
| The key was revoked or copied partly    | Copy the code again from **Website**.                                                                     |
| No services or offices open for booking | In **Services**, set services to "Shown in the booking form"; keep at least one office active.            |
| SMS isn't set up on the platform yet    | The message appears after the client enters a phone number. Contact DentBook support.                     |

To see the exact reason, open the page, press F12, go to the **Network** tab and reload. The
failed request to `/v1/public/…` shows a code in its response: `origin_not_allowed` or
`invalid_key`.

Two more cases:

- **No free times:** check that the service is assigned to dentists, that they have working
  hours in this office, and that the dates fall within **Book ahead, days** in **Settings**.
- **Nothing appears at all:** the code was pasted as text. Paste it into an HTML or code
  block.
- **A button doesn't open the popup:** check that the popup code is on that page too, and
  that the button has the class `dentbook-open` exactly, without a dot.

## What happens after a booking

- The booking appears in the **Journal**. If your clinic confirms bookings by hand, it waits
  there as "Awaits confirmation". The dentist can confirm it in Telegram.
- The client gets SMS reminders 24 hours and 2 hours before the visit. The client can cancel
  from the confirmation screen, and the time frees up at once.
- To move a booking, drag it in the **Journal**. The client gets an SMS with the new time.
