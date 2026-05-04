# Admin Actions Triggered from HTML

Based on a search through the frontend code (HTML and JS files), here are all the actions and UI elements that currently require admin privileges (`data-requires-role="admin"`). 

Given that the Python batch pipeline (`scraping_daemon.py`, `analysis_daemon.py`, etc.) now handles the automated syncing and analysis building, most of these manual triggers are indeed redundant.

### 1. `index.html` (Main Dashboard)
There is a large **Admin Side Panel** (`#admin-side-panel`) on the right side of the screen with several manual sync and rebuild triggers:
- **"Check for New Protocols"** (`#admin-protocol-check-button`)
- **"Check for New Laws"** (`#admin-law-check-button`)
- **"Analyze New Laws"** (`#admin-law-analysis-check-button`)
- **"Generate Surprising Vote Explanations"** (`#admin-surprising-vote-explanations-button`)

There is also a **"Danger Zone"** section within that panel for forcing complete rebuilds:
- **"Rebuild All Law Analyses"** (`#admin-law-analysis-rebuild-button`)
- **"Rebuild All Small Quotes (Utterance Files)"** (`#admin-small-quotes-rebuild-button`)
- **"Rebuild All Member Profiles"** (`#admin-member-profiles-rebuild-button`)

There is also a hidden section **"Law Analysis Tools"** (`#law-analysis-tools`) which seems to hold batch actions.

### 2. `members.html` (Members List Page)
There are two buttons in the "Updates Status" panel for manually triggering a bulk analysis across all members:
- **"נתח את כל חברי הכנסת מהקובץ הקטן"** (Analyze all members from small file)
- **"נתח את כל חברי הכנסת מהקובץ הגדול"** (Analyze all members from full file)

### 3. `law.js` (Law Details Page - Dynamically Rendered)
On the individual law page, next to a surprising vote (where a member voted against their expected voting pattern), there is a button rendered dynamically:
- **"Generate Explanation"** (`data-surprise-explain` button) - manually forces Gemini to explain why a specific member voted surprisingly on this law.

### 4. `how-we-know.html` (Methodology Page)
There is an admin control panel (`#methodology-admin-controls`) at the top of the methodology page.
- **"Refresh Metrics"** (or similar sync actions) to update the documentation stats manually.

***

*Note: These buttons exist in the HTML but currently trigger API endpoints (`/api/...`) that are either stubbed or return 501 Not Implemented since the Node.js server was retired.*