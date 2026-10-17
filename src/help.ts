/**
 * First-time user guide, shown from the "?" button in the header (and on a
 * device's first visit). Plain static HTML so it works offline.
 */
export const HELP_HTML = `
  <h1>How to use the app</h1>
  <p class="lede">A job usually runs left to right along the bottom bar: price it, quote it, win it, get paid. Tap a heading to open it.</p>

  <div class="help">
    <details>
      <summary>1. Get the app on your phone</summary>
      <ol>
        <li>Open <b>app.grbhomeimprovements.co.uk</b>: <b>Safari</b> on iPhone, <b>Chrome</b> on Android.</li>
        <li>Add it to the home screen. iPhone: <b>Share</b> → <b>Add to Home Screen</b>. Android: <b>⋮</b> → <b>Install app</b>.</li>
        <li>Open it from the GRB icon. Give it a few seconds online the first time so it saves itself for offline use.</li>
      </ol>
      <p>Quotes, estimates and PDFs then work with no signal. Only Google Drive, the calendars and Xero need a connection.</p>
    </details>

    <details>
      <summary>2. The five tabs</summary>
      <dl>
        <dt>Quick</dt><dd>A ballpark price range in seconds, on the first visit.</dd>
        <dt>Estimate</dt><dd>A line-by-line priced estimate and the PDF quote.</dd>
        <dt>Quotes</dt><dd>Every saved quote, plus Google Drive.</dd>
        <dt>Jobs</dt><dd>Won jobs: start date, programme, who's on site.</dd>
        <dt>Money</dt><dd>Invoices to send, what's due and paid, plus Xero. Check it every Monday.</dd>
      </dl>
    </details>

    <details>
      <summary>3. Give a quick price on site</summary>
      <ol>
        <li>On <b>Quick</b>, pick the <b>Job type</b> and <b>Spec level</b> (Budget, Standard or Premium).</li>
        <li>Type in the <b>Floor area</b> in m².</li>
        <li>Check the <b>Region</b> (South London is the default) and the <b>Roof type</b>.</li>
      </ol>
      <p>The range shows straight away, inc VAT, with a midpoint. It's a ballpark, not a quotation: tell the client a proper quote will follow.</p>
    </details>

    <details>
      <summary>4. Build a detailed estimate</summary>
      <p><b>Got the architect's drawings?</b> At the top of <b>Estimate</b>, under <b>Price from drawings</b>, choose the PDFs (or photos of the sheets), add any notes (spec, what the client supplies) and tap <b>Read drawings</b>. In a minute or two the estimate is filled in, with notes on what was measured, what was assumed and what to check on site. Then check each section as below. Needs signal.</p>
      <ol>
        <li>On <b>Estimate</b>, tap <b>Start blank</b> (or <b>Load example job</b> to see a finished one).</li>
        <li>Fill in the reference (e.g. CR30/1), client and address.</li>
        <li>Add <b>labour and materials</b> lines: pick from the rate library and enter the quantity. Sundries go in materials.</li>
        <li>Fill in the packages: <b>footings</b> are our own team; <b>roof, electrics, plumbing</b> are subbed (enter the subbie's price, the app adds the markup); <b>plant, waste and fees</b> are at cost.</li>
        <li>Once drawings and spec are confirmed, tick <b>Drawings &amp; spec confirmed</b> (contingency drops from 12% to 8%).</li>
        <li>Check the total and tap <b>Save quote</b>.</li>
      </ol>
      <p>You don't need to work out uplift, contingency or profit: the app does it, and the rates already include the South London uplift and inflation.</p>
    </details>

    <details>
      <summary>5. Send the client a PDF quote</summary>
      <ol>
        <li>Scroll down <b>Estimate</b> to the client quote section.</li>
        <li>Add the greeting, the deposit and the weeks on site.</li>
        <li>Fill in <b>Client email (for Xero invoices)</b>.</li>
        <li>Tap <b>Create PDF quote</b>, check the PDF, then send it by email or WhatsApp.</li>
      </ol>
    </details>

    <details>
      <summary>6. Saved quotes and Google Drive</summary>
      <p>Saved quotes stay on your phone. Connect Google Drive once per phone so every quote is also copied to the <b>GRB Quotes</b> folder:</p>
      <ol>
        <li>On <b>Quotes</b>, tap <b>Connect Google Drive</b>.</li>
        <li>Sign in with your <b>@grbhomeimprovements.co.uk</b> account (personal Gmail won't work) and allow access.</li>
      </ol>
      <p>Each saved quote then uploads as a PDF plus a file the app can reopen; offline, it uploads when you're back online. On <b>Quotes</b> you can also search, <b>Open quote</b>, <b>Duplicate</b>, and <b>Export all</b> / <b>Import</b> to move quotes between phones.</p>
    </details>

    <details>
      <summary>7. When the client says yes</summary>
      <p><b>Once:</b> on <b>Jobs</b>, open <b>Team &amp; subbies</b> and tap <b>+ Add person</b> for each crew member and subbie.</p>
      <ol>
        <li>On <b>Quotes</b>, tap <b>Won → job</b>.</li>
        <li>Enter the <b>Accepted</b> and <b>Start on site</b> dates; check <b>Payment terms (days)</b>.</li>
        <li>Adjust the suggested programme and pick <b>who</b> is on each stage.</li>
      </ol>
      <p>The deposit is invoiced on the accepted date, then one invoice each Monday of the programme. If the start slips, change it on the job and un-invoiced payments move with it.</p>
      <p>Tap <b>Sync now</b> on the Google Calendar &amp; Sheet card to fill the <b>GRB Jobs</b> and <b>GRB Payments</b> calendars and the <b>GRB Jobs &amp; Payments</b> sheet. Tap <b>Jobs calendar</b> to add it to your own calendar.</p>
    </details>

    <details>
      <summary>8. Send invoices and track payments</summary>
      <ol>
        <li>Open <b>Money</b>: invoices to raise are at the top.</li>
        <li>Under <b>New invoices</b>, choose <b>Draft</b> (office checks and sends from Xero) or <b>Approve + email</b> (Xero emails the client straight away).</li>
        <li>Tap <b>Create in Xero</b> on one payment, or <b>Create all</b>.</li>
        <li>Tap <b>Check payments</b> to pick up what's been paid (it also runs every 10 minutes while the tab is open).</li>
      </ol>
      <p>Invoiced outside Xero? Use <b>Mark invoiced</b> and <b>Mark paid</b>; <b>Undo paid</b> reverses a mistake.</p>
    </details>

    <details>
      <summary>9. Tips and fixes</summary>
      <dl>
        <dt>Asked to sign in to Google again</dt><dd>Normal: sign-in lasts about an hour. Tap it and sign in.</dd>
        <dt>"Only GRB accounts"</dt><dd>You used a personal Gmail. Sign in with your @grbhomeimprovements.co.uk account.</dd>
        <dt>No signal on site</dt><dd>Carry on. Drive uploads when you're back online.</dd>
        <dt>Quote missing on another phone</dt><dd>Quotes are saved per phone. Open it from the GRB Quotes folder, or use Export all / Import.</dd>
        <dt>Xero needs connecting again</dt><dd>Whoever looks after Xero taps <b>Connect Xero</b> on Money and signs in.</dd>
        <dt>A Xero invoice failed</dt><dd>The reason shows next to the payment. Fix it and tap <b>Create in Xero</b> again; it won't make a duplicate.</dd>
        <dt>Prices look out of date</dt><dd>Rates come from the GRB Pricing Tool spreadsheet. Update it, then ask for the rates to be re-loaded into the app.</dd>
      </dl>
      <p>One person should run each job, so its dates and payments stay in step across phones.</p>
    </details>
  </div>
`
