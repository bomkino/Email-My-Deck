// Free ways to send a deck as a link, for the "Send a link instead" section.
//
// Every limit here was read on the service's own site on CHECKED, and each
// service lists the pages it came from. Free plans change often: before
// changing a fact, re-read its source, then update CHECKED.
//
// The order of SERVICES is our order for a pitch deck: what the reader sees
// when they click comes first, then how long the link lasts.
import type { Pick, Service } from './types'

export const CHECKED = '2026-10-06'
export const CHECKED_TEXT = '6 October 2026'

const no = (text = 'No') => ({ yes: false, text })
const yes = (text = 'Yes') => ({ yes: true, text })

export const SERVICES: Service[] = [
  {
    id: 'google-drive',
    name: 'Google Drive',
    url: 'https://drive.google.com/',
    line: 'The link most people have opened before. Your deck turns up as a preview, page by page, and nobody has to sign in.',
    facts: {
      looks: yes('A preview in the browser'),
      lasts: yes('Until you stop sharing'),
      'no-signup': no('Google account'),
      private: no(),
      opened: no(),
      huge: yes('15 GB, shared with Gmail'),
    },
    how: [
      'At **drive.google.com**, upload your deck, then right-click it and choose **Share**.',
      'Under **General access**, choose **Anyone with the link**, and leave the role on **Viewer**.',
      'Click **Copy link**, then **Done**, and paste the link into your email.',
    ],
    watch: [
      'Everyone who opens it can see your name and email as the owner.',
      'Viewers can download it. To stop that, open **Settings** in the share box and untick viewers under **People who can download, copy, and print**.',
      'Skip **Public**. That one lets anyone find the deck through Google search.',
      'In Gmail, an attachment over 25 MB becomes a Drive link by itself. When Gmail says your recipients don’t have access, give anyone with the link view access.',
    ],
    sources: [
      { label: 'storage', url: 'https://support.google.com/googleone/answer/9312312?hl=en' },
      { label: 'sharing by link', url: 'https://support.google.com/drive/answer/2494822?hl=en' },
      { label: 'download settings', url: 'https://support.google.com/drive/answer/2494893?hl=en' },
      { label: 'Gmail’s 25 MB limit', url: 'https://support.google.com/mail/answer/6584?hl=en' },
      { label: 'Drive links in Gmail', url: 'https://support.google.com/mail/answer/2487407?hl=en' },
    ],
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    url: 'https://www.dropbox.com/basic',
    line: 'A clean preview and a link that lasts. The free plan holds 2 GB, which is plenty of decks.',
    facts: {
      looks: yes('A preview in the browser'),
      lasts: yes('Until you delete it'),
      'no-signup': no('Dropbox account'),
      private: no(),
      opened: no(),
      huge: no('2 GB in total'),
    },
    how: [
      'At **dropbox.com**, upload your deck, hover over it and click **Share**.',
      'Make it a **Link for viewing**, not a **Link for editing**, then click **Copy link**.',
      'Paste the link into your email. Skip **Add people**: that route asks them to sign in to Dropbox.',
    ],
    watch: [
      'Passwords, end dates and switching off downloads are for paid plans only.',
      'Free links can serve 20 GB a day, views included. That’s about 400 opens of a 50 MB deck, and past it, sharing pauses for 24 hours.',
      'Want to know if it was downloaded? Dropbox Transfer counts views and downloads on the free plan too, but it’s a download, not a preview, and it expires after 7 days.',
    ],
    sources: [
      { label: 'the free plan', url: 'https://www.dropbox.com/basic' },
      { label: 'sharing a link', url: 'https://help.dropbox.com/share/create-and-share-link' },
      { label: 'link settings by plan', url: 'https://help.dropbox.com/share/set-link-permissions' },
      { label: 'daily limits', url: 'https://help.dropbox.com/share/banned-links' },
      { label: 'Dropbox Transfer', url: 'https://help.dropbox.com/share/dropbox-transfer' },
    ],
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    url: 'https://onedrive.live.com/',
    line: 'Comes with every Microsoft account. The link lasts, but it starts out letting people edit, so switch that off.',
    facts: {
      looks: yes('A preview, up to 100 MB'),
      lasts: yes('Until you remove it'),
      'no-signup': no('Microsoft account'),
      private: no(),
      opened: no(),
      huge: no('5 GB, shared with Outlook'),
    },
    how: [
      'At **onedrive.com**, upload your deck, tick its circle and choose **Share**.',
      'Open the link settings, choose **Anyone**, and untick **Allow editing**. It starts ticked.',
      'Click **Apply**, then **Copy**, and paste the link into your email.',
    ],
    watch: [
      'Decks over 100 MB get no preview, so your reader has to download them.',
      'Moving the file breaks the link.',
      'End dates and passwords need a Microsoft 365 subscription.',
      'Outlook.com can attach it with **Upload and share**, but that link lets everyone edit until you change it. Making the link in OneDrive, as above, is simpler.',
    ],
    sources: [
      { label: 'storage', url: 'https://support.microsoft.com/en-us/onedrive/microsoft-storage-quotas' },
      { label: 'sharing', url: 'https://support.microsoft.com/en-us/onedrive/share-files-and-folders-in-microsoft-onedrive' },
      { label: 'preview limit', url: 'https://support.microsoft.com/en-us/onedrive/restrictions-and-limitations-in-onedrive-and-sharepoint' },
      { label: 'Outlook attachments', url: 'https://support.microsoft.com/en-us/outlook/mail/add-pictures-or-attach-files-to-emails-in-outlook' },
    ],
  },
  {
    id: 'proton-drive',
    name: 'Proton Drive',
    url: 'https://proton.me/drive',
    line: 'End-to-end encrypted, so not even Proton can open your deck. Free links can have a password and an end date.',
    facts: {
      looks: yes('Opens in the browser'),
      lasts: yes('Until you stop sharing, or a date you set'),
      'no-signup': no('Proton account'),
      private: yes('Yes'),
      opened: no(),
      huge: no('5 GB, after setup'),
    },
    how: [
      'At **drive.proton.me**, upload your deck, select it and click the share icon.',
      'Turn on **Create public link** and keep access on **Viewer**.',
      'For a confidential deck, click **Set password or expiration date**, turn on **Require password** or **Expiry**, then **Save changes**.',
      'Click **Copy link** and paste it into your email. Send any password separately.',
    ],
    watch: [
      'The page they open shows your Proton email address.',
      'New accounts start with 2 GB. Finish Proton’s welcome checklist in your first 30 days to get 5 GB.',
    ],
    sources: [
      { label: 'plans', url: 'https://proton.me/drive/pricing' },
      { label: 'public links', url: 'https://proton.me/support/drive-shareable-link' },
      { label: 'passwords and end dates', url: 'https://proton.me/support/drive-manage-access-shared-files' },
      { label: 'files it previews', url: 'https://proton.me/support/drive-previewable-file-types' },
      { label: 'storage', url: 'https://proton.me/support/more-storage-proton-drive' },
    ],
  },
  {
    id: 'papermark',
    name: 'Papermark',
    url: 'https://www.papermark.com/',
    line: 'Made for sending decks. You hear when someone opens it, and see how long they spent on each page.',
    facts: {
      looks: yes('A deck viewer in the browser'),
      lasts: yes('Until you remove it, or a date you set'),
      'no-signup': no('Papermark account'),
      private: no(),
      opened: yes('Every view, page by page'),
      huge: no('30 MB a file'),
    },
    how: [
      'Sign up at **papermark.com** and upload your deck. Make a new link for each person you send it to, so their views don’t blur together.',
      'In the link settings, turn on **Receive email notification**.',
      'Decide on **Allow downloading**: off keeps them in the viewer, on lets them keep a copy. Then copy the link into your email.',
    ],
    watch: [
      'The free plan takes files up to 30 MB, says Papermark’s own guide. A heavier deck needs squeezing first, which the tool at the top of this page can do.',
      'Free keeps the last 20 views for 30 days, and puts “Powered by Papermark” on your deck.',
      '**Require email to view** tells you exactly who read it, but it’s one more step before they see your first slide.',
      'Free covers 50 documents and 50 links. One link per investor adds up in a big raise.',
    ],
    sources: [
      { label: 'plans', url: 'https://www.papermark.com/pricing' },
      { label: 'the 30 MB limit', url: 'https://www.papermark.com/blog/how-to-send-large-pdf-files-over-email' },
      { label: 'link settings', url: 'https://www.papermark.com/help/article/link-settings' },
      { label: 'view emails', url: 'https://www.papermark.com/help/article/email-notifications' },
      { label: 'branding', url: 'https://www.papermark.com/help/article/remove-papermark-branding' },
    ],
  },
  {
    id: 'swisstransfer',
    name: 'SwissTransfer',
    url: 'https://www.swisstransfer.com/en',
    line: 'No account on either side, no ads, up to 50 GB, and stored in Switzerland. It isn’t open in every country.',
    facts: {
      looks: no('A download page'),
      lasts: no('Up to 30 days'),
      'no-signup': yes('None, just your email'),
      private: no('No, but kept in Switzerland'),
      opened: yes('When it’s downloaded'),
      huge: yes('50 GB a transfer'),
    },
    how: [
      'At **swisstransfer.com**, add your deck and choose to get a link rather than send an email.',
      'Set it to last **15 days**. Choose **30 days** only if you’ll click the extension email it sends on day 12. Without that click, it’s deleted on day 15.',
      'Set downloads to **250**, so the deck still opens when it’s forwarded.',
      'Confirm your email, which it asks once per device, then copy the link into your email.',
    ],
    watch: [
      'You can’t send from some countries, including India, Mexico, Israel, the UAE and Saudi Arabia. Infomaniak’s getting-started guide has the full list.',
      'Infomaniak describes no preview, so expect your reader to download the deck.',
      'Once a link has expired, nobody can bring it back, not even their support team.',
    ],
    sources: [
      { label: 'what’s free', url: 'https://www.infomaniak.com/en/swisstransfer' },
      { label: 'limits and expiry', url: 'https://www.infomaniak.com/en/support/faq/2929/understanding-swisstransfer-data-limits' },
      { label: 'countries', url: 'https://www.infomaniak.com/en/support/faq/2451/getting-started-guide-swisstransfer-send-large-files-for-free' },
      { label: 'download emails', url: 'https://www.swisstransfer.com/en' },
    ],
  },
  {
    id: 'mail-drop',
    name: 'iCloud Mail Drop',
    url: 'https://support.apple.com/en-us/108329',
    line: 'Built into Apple Mail. Attach the deck as usual, and Mail sends a download link in its place.',
    facts: {
      looks: no('A download link'),
      lasts: no('30 days'),
      'no-signup': no('Apple Account'),
      private: no(),
      opened: no(),
      huge: no('5 GB an email'),
    },
    how: [
      'In Mail on your Mac, iPhone or iPad, or at **icloud.com/mail**, attach your deck as usual.',
      'When Mail offers to use Mail Drop, say yes. From an iCloud address, it happens without asking.',
      'Mention in your email that the link works for 30 days.',
    ],
    watch: [
      'You need to be signed in to an Apple Account, and it only works from Apple’s Mail apps or iCloud.com.',
      'Once it’s sent, you can’t take it back or give it longer than 30 days.',
      'Apple says a link with very heavy traffic can stop working for the people trying to open it.',
      'On a Mac it’s a setting: **Send large attachments with Mail Drop**, in Mail’s account settings.',
    ],
    sources: [
      { label: 'limits', url: 'https://support.apple.com/en-us/108329' },
      { label: 'Mail on a Mac', url: 'https://support.apple.com/guide/mail/send-attachments-mlhlp1050/mac' },
      { label: 'iCloud.com', url: 'https://support.apple.com/guide/icloud/add-an-attachment-mm6b1a7a10/icloud' },
    ],
  },
  {
    id: 'tresorit-send',
    name: 'Tresorit Send',
    url: 'https://send.tresorit.com/',
    line: 'End-to-end encrypted with no account to make. Each link lasts 7 days and 10 downloads.',
    facts: {
      looks: no('A download page'),
      lasts: no('7 days'),
      'no-signup': yes('None, just your email'),
      private: yes('Yes'),
      opened: yes('When it’s opened'),
      huge: no('5 GB a transfer'),
    },
    how: [
      'At **send.tresorit.com**, add your deck and enter your email address.',
      'Under **Link settings**, turn on **Email me when someone opens my link**. Add **Protect link with password** if the deck is confidential.',
      'Click **Create Secure Link** and copy the link straight away. It isn’t in the email they send you, and it can’t be shown again.',
      'Open the admin link in that email, so your address shows as verified on their page.',
    ],
    watch: [
      'Each file can be downloaded 10 times, which a deck forwarded around a firm can use up.',
      'Links can’t be changed. A corrected deck needs a new link.',
      'Tresorit says recipients can view and download, but not how a PDF looks there, so expect a download.',
    ],
    sources: [
      { label: 'how it works', url: 'https://support.tresorit.com/hc/en-us/articles/360007285474-Tresorit-Send-overview' },
      { label: 'FAQ', url: 'https://support.tresorit.com/hc/en-us/articles/360012183493-Tresorit-Send-FAQ' },
      { label: 'the admin link', url: 'https://support.tresorit.com/hc/en-us/articles/360011293134-Tresorit-Send-admin-link' },
    ],
  },
  {
    id: 'transfernow',
    name: 'TransferNow',
    url: 'https://www.transfernow.net/en',
    line: 'No account, a preview of your deck, and an email when it’s downloaded. The free download page shows ads.',
    facts: {
      looks: yes('A preview, then download'),
      lasts: no('7 days'),
      'no-signup': yes('None'),
      private: no(),
      opened: yes('When it’s downloaded'),
      huge: no('5 GB a transfer'),
    },
    how: [
      'At **transfernow.net**, add your deck and choose to get a share link.',
      'Enter your email and keep download notifications on.',
      'Leave the file preview on, which it is to start with, then copy the link into your email.',
    ],
    watch: [
      'Free download pages show ads, so your deck shares the screen with someone else’s.',
      'Free links last 7 days, and you can’t make them last longer.',
      'Its terms let it delete free files early, without telling you, if keeping them gets too costly.',
    ],
    sources: [
      { label: 'plans', url: 'https://www.transfernow.net/en/prices' },
      { label: 'what’s free', url: 'https://www.transfernow.net/en/discover/transfernow-free-forever' },
      { label: 'terms', url: 'https://www.transfernow.net/en/legal/terms' },
    ],
  },
  {
    id: 'wetransfer',
    name: 'WeTransfer',
    url: 'https://wetransfer.com/',
    line: 'The name everyone knows, and a good preview. Free links last three days, which is short for a deck.',
    facts: {
      looks: yes('A preview, then download'),
      lasts: no('3 days'),
      'no-signup': no('WeTransfer account'),
      private: no(),
      opened: yes('On the first download'),
      huge: no('3 GB a month'),
    },
    how: [
      'At **wetransfer.com**, add your deck and choose to get a link rather than send an email. Senders need a free account, so confirm your email when it asks.',
      'Copy the link and paste it into your own email, so it arrives from you.',
      'Send it when they’re ready to look. Three days is the longest a free link lasts.',
    ],
    watch: [
      'Free covers 10 transfers or 3 GB in any 30 days, whichever runs out first.',
      'One of WeTransfer’s comparison pages says free transfers are “for non-commercial use only”. Its terms don’t say so, but it’s worth knowing if you’re raising money.',
    ],
    sources: [
      { label: 'free limits', url: 'https://wetransfer.com/help-center/subscriptions/plan-limits' },
      { label: 'how long transfers last', url: 'https://wetransfer.com/help-center/how-to/transfer-availability' },
      { label: 'accounts', url: 'https://wetransfer.com/help-center/accounts/why-account-needed-to-send' },
      { label: 'download emails', url: 'https://wetransfer.com/help-center/how-to/confirmation-emails' },
      { label: 'non-commercial note', url: 'https://wetransfer.com/resources/comparison/wetransfer-vs-transfernow' },
    ],
  },
]

export const PICKS: Pick[] = [
  { for: 'all', label: 'Our pick', service: 'google-drive', why: 'It opens as a clean preview in any browser, nobody has to sign in, and the link works until you stop sharing. Most people have opened a Drive link before.' },
  { for: 'private', label: 'Most private', service: 'proton-drive', why: 'End-to-end encrypted, so Proton can’t read it either. The free plan adds a password and an end date to the link.' },
  { for: 'no-signup', label: 'No sign-up at all', service: 'swisstransfer', why: 'No account for you or for them, no ads, and up to 50 GB. Check it’s open in your country before you count on it.' },
  { for: 'opened', label: 'Tells you they looked', service: 'papermark', why: 'Built for decks: an email each time it’s viewed, and how long they spent on every page. The free plan takes files up to 30 MB.' },
]

/** Checked too, and left off the list for decks. */
export const LEFT_OUT: { name: string; why: string; url: string }[] = [
  { name: 'Smash', why: 'doesn’t preview PDFs', url: 'https://fromsmash.com/help/articles/13230436-what-file-type-can-i-preview-before-downloading' },
  { name: 'Filemail', why: 'allows two free transfers a day', url: 'https://support.filemail.com/en/articles/4103694-free-file-sharing-service' },
  { name: 'Wormhole', why: 'deletes files after 24 hours', url: 'https://wormhole.app/faq' },
  { name: 'MEGA', why: 'keeps passwords and end dates for paid plans', url: 'https://help.mega.io/security/data-protection/make-links-more-secure' },
  { name: 'DocSend', why: 'adds its own sign-up page to the end of your deck once the trial ends', url: 'https://help.dropbox.com/plans/dropbox-docsend-limited-trial' },
]
