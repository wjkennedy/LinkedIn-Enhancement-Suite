# Chrome Web Store privacy practices

Privacy-policy URL: `https://wjkennedy.github.io/LinkedIn-Enhancement-Suite/privacy.html`

LES processes LinkedIn page content locally to apply the user's feed preferences. It stores extension settings and filter rules locally in the browser. LES does not sell, rent, or use this information for advertising, and does not transmit LinkedIn page content, filter rules, or local extension data to LES developers.

## Limited Use disclosure

LES uses information obtained through Chrome permissions only to provide its LinkedIn feed controls. LES does not transfer that information to third parties, use it for advertising, or allow people to read it. This use complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Permission justifications

- **Host permission (`https://*.linkedin.com/*`)**: Lets LES run on LinkedIn pages and apply the user's selected feed filters and display preferences. It does not run on unrelated sites.
- **storage / unlimitedStorage**: Saves extension settings, filter rules, and local state in the browser.
- **tabs / scripting**: Supports LES functionality in LinkedIn tabs, including opening user-requested links and applying LES's packaged scripts.
- **history**: Supports user-initiated features that check or add a specific URL to browser history. It is not used for profiling or advertising.
- **downloads**: Used only after the user requests a download or export.
- **webRequest / declarativeNetRequest**: Used only for narrowly scoped LinkedIn functionality and extension-controlled authentication flows where applicable; not to monitor general browsing activity.
