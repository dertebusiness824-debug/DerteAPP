/** The copy-paste snippet a shop owner adds to their Hostinger site. */
export const embedSnippet = ({ publicKey, appUrl }) =>
  `<!-- DerteApp booking + schedule guard -->
<script
  src="${appUrl}/embed/derteapp.js"
  data-derte-key="${publicKey}"
  data-derte-api="${appUrl}"
  data-derte-form="[data-derte='booking-form']"
  defer
></script>`;

export default embedSnippet;
