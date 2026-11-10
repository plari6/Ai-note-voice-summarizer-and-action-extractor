/** Offline sample: a 3-minute CEO voice note recorded on Tuesday 10 Nov 2026. */
export const DEMO_DATE = '2026-11-10';
export const DEMO_NAME = 'ceo-voice-note-2026-11-10.txt';

export const DEMO_TRANSCRIPT = `[00:00] Okay, quick brain dump after the board call, there's a lot here so bear with me.
[00:06] First, the Hartwell renewal. They're wobbling on price and that's a four hundred K account, so that's the top priority this week.
[00:14] Sarah, I need you to put together a revised proposal for Hartwell with the three year option and get it to me by Thursday so I can review it before it goes out.
[00:24] And ask Omar to run the numbers on a ten percent discount versus a longer term, I want to see the margin impact before I talk to their CFO.
[00:35] I'll call Hartwell's CFO myself on Friday morning, so Jake, please block an hour on my calendar for that and send me their last QBR deck.
[00:46] Second thing, the board wants the hiring plan for Q1 by the end of the month. We decided to freeze the two junior sales roles and go with one senior account executive instead.
[00:58] Priya, can you update the job description for the senior AE and get it posted by next Friday.
[01:06] Um, the Q3 board deck had the wrong churn number on slide twelve, it said four percent, it's actually five point two. Omar needs to send a corrected version to the board today, that's urgent, it's an accuracy thing.
[01:20] I need to reply to the investor update thread from Marcus, he asked about our runway, I'll do that tomorrow.
[01:28] Marketing. The webinar with Datafront is slipping, I'm worried we won't have the landing page ready in time.
[01:35] Priya, after the job description, please get the webinar landing page live within two weeks, and loop in the design agency.
[01:43] I'm not sure whether we should do the Lisbon offsite in February or push it to March. Jake, find out the venue availability for both and let me know, no rush, sometime next week is fine.
[01:55] Also we need to finalise the new expense policy before the end of the quarter, the team keeps asking.
[02:03] One idea, what if we offered Hartwell a dedicated success manager instead of a bigger discount, park that for now but remind me to think about it.
[02:12] Oh and Sarah, schedule a pipeline review with the whole sales team on Monday, I want every deal over fifty K on one page.
[02:20] And again, the Hartwell proposal by Thursday, that's the one thing that cannot slip. Okay, that's it, thanks.`;

/** What the AI step returns for the sample (used by `demo` so it works without keys). */
export const DEMO_ANALYSIS = {
  title: 'Post-board brain dump: Hartwell renewal, Q1 hiring, board deck fix',
  language: 'English',
  summary:
    'After the board call the CEO set the Hartwell renewal ($400K, at risk on price) as this week\'s top priority, with a revised 3-year proposal due Thursday and a CFO call on Friday. The board needs the Q1 hiring plan by month end: two junior sales roles are frozen in favour of one senior AE. A wrong churn figure in the Q3 board deck must be corrected today.',
  key_points: [
    'Hartwell renewal ($400K) is at risk on price - top priority this week',
    'Revised 3-year Hartwell proposal due Thursday; CEO calls their CFO Friday morning',
    'Discount vs longer-term margin analysis needed before the CFO call',
    'Q1 hiring plan due to the board by end of month; one senior AE replaces two junior roles',
    'Q3 board deck shows churn at 4% instead of 5.2% - correction goes out today',
    'Datafront webinar landing page is at risk of slipping',
    'Lisbon offsite: February or March still open',
  ],
  tasks: [
    { title: 'Send revised Hartwell proposal with 3-year option to CEO for review', details: 'Include the three year option; CEO reviews before it goes to Hartwell.', owner: 'Sarah', owner_type: 'delegate', due_phrase: 'by Thursday', due_date: '2026-11-12', priority: 'high', category: 'sales_clients', depends_on: [], source_quote: 'put together a revised proposal for Hartwell with the three year option and get it to me by Thursday', timestamp: '00:14', confidence: 0.97 },
    { title: 'Model margin impact of 10% discount vs longer term for Hartwell', details: 'Needed before the CEO talks to the Hartwell CFO on Friday.', owner: 'Omar', owner_type: 'delegate', due_phrase: '', due_date: '', priority: 'high', category: 'finance', depends_on: [], source_quote: 'run the numbers on a ten percent discount versus a longer term', timestamp: '00:24', confidence: 0.92 },
    { title: "Call Hartwell's CFO about the renewal", details: '', owner: 'Me', owner_type: 'self', due_phrase: 'Friday morning', due_date: '2026-11-13', priority: 'high', category: 'sales_clients', depends_on: [0, 1], source_quote: "I'll call Hartwell's CFO myself on Friday morning", timestamp: '00:35', confidence: 0.95 },
    { title: 'Block one hour on CEO calendar Friday morning for Hartwell CFO call', details: '', owner: 'Jake', owner_type: 'delegate', due_phrase: 'Friday morning', due_date: '2026-11-13', priority: 'high', category: 'meeting', depends_on: [], source_quote: 'Jake, please block an hour on my calendar for that', timestamp: '00:35', confidence: 0.93 },
    { title: "Send CEO Hartwell's last QBR deck", details: 'Prep for the CFO call.', owner: 'Jake', owner_type: 'delegate', due_phrase: '', due_date: '', priority: 'medium', category: 'communication', depends_on: [], source_quote: 'send me their last QBR deck', timestamp: '00:35', confidence: 0.9 },
    { title: 'Deliver Q1 hiring plan to the board', details: 'Plan reflects the decision: freeze two junior sales roles, hire one senior account executive.', owner: 'Me', owner_type: 'self', due_phrase: 'by the end of the month', due_date: '2026-11-30', priority: 'medium', category: 'people_hiring', depends_on: [], source_quote: 'the board wants the hiring plan for Q1 by the end of the month', timestamp: '00:46', confidence: 0.8 },
    { title: 'Update senior AE job description and post it', details: '', owner: 'Priya', owner_type: 'delegate', due_phrase: 'by next Friday', due_date: '2026-11-20', priority: 'medium', category: 'people_hiring', depends_on: [], source_quote: 'update the job description for the senior AE and get it posted by next Friday', timestamp: '00:58', confidence: 0.95 },
    { title: 'Send corrected Q3 board deck to the board (churn 5.2%, slide 12)', details: 'Slide 12 says 4% churn; the correct figure is 5.2%.', owner: 'Omar', owner_type: 'delegate', due_phrase: 'today', due_date: '2026-11-10', priority: 'high', category: 'finance', depends_on: [], source_quote: 'Omar needs to send a corrected version to the board today, that\'s urgent', timestamp: '01:06', confidence: 0.98 },
    { title: "Reply to Marcus's investor update thread about runway", details: '', owner: 'Me', owner_type: 'self', due_phrase: 'tomorrow', due_date: '2026-11-11', priority: 'medium', category: 'communication', depends_on: [], source_quote: "I need to reply to the investor update thread from Marcus, he asked about our runway, I'll do that tomorrow", timestamp: '01:20', confidence: 0.94 },
    { title: 'Get Datafront webinar landing page live with the design agency', details: 'Start after the senior AE job description. Loop in the design agency.', owner: 'Priya', owner_type: 'delegate', due_phrase: 'within two weeks', due_date: '2026-11-24', priority: 'medium', category: 'product', depends_on: [6], source_quote: 'please get the webinar landing page live within two weeks, and loop in the design agency', timestamp: '01:35', confidence: 0.9 },
    { title: 'Check Lisbon venue availability for February and March offsite', details: 'Report back so the CEO can decide between February and March.', owner: 'Jake', owner_type: 'delegate', due_phrase: 'sometime next week', due_date: '2026-11-16', priority: 'low', category: 'operations', depends_on: [], source_quote: 'Jake, find out the venue availability for both and let me know, no rush', timestamp: '01:43', confidence: 0.88 },
    { title: 'Finalise the new expense policy', details: 'The team keeps asking for it.', owner: 'Team', owner_type: 'team', due_phrase: 'before the end of the quarter', due_date: '2026-12-31', priority: 'medium', category: 'legal_admin', depends_on: [], source_quote: 'we need to finalise the new expense policy before the end of the quarter', timestamp: '01:55', confidence: 0.85 },
    { title: 'Think about offering Hartwell a dedicated success manager instead of a bigger discount', details: 'Parked idea - reminder only.', owner: 'Me', owner_type: 'self', due_phrase: '', due_date: '', priority: 'low', category: 'sales_clients', depends_on: [], source_quote: 'park that for now but remind me to think about it', timestamp: '02:03', confidence: 0.75 },
    { title: 'Schedule pipeline review with the sales team (all deals over $50K on one page)', details: '', owner: 'Sarah', owner_type: 'delegate', due_phrase: 'on Monday', due_date: '2026-11-16', priority: 'medium', category: 'meeting', depends_on: [], source_quote: 'Sarah, schedule a pipeline review with the whole sales team on Monday', timestamp: '02:12', confidence: 0.92 },
    { title: 'Send revised Hartwell proposal with the 3-year option to CEO for review', details: '', owner: 'Sarah', owner_type: 'delegate', due_phrase: 'by Thursday', due_date: '2026-11-12', priority: 'high', category: 'sales_clients', depends_on: [], source_quote: 'the Hartwell proposal by Thursday, that\'s the one thing that cannot slip', timestamp: '02:20', confidence: 0.9 },
  ],
  decisions: [
    { decision: 'Freeze the two junior sales roles and hire one senior account executive instead', timestamp: '00:46' },
    { decision: 'Hartwell renewal is the top priority this week', timestamp: '00:06' },
  ],
  open_questions: ['Lisbon offsite in February or March?', 'Offer Hartwell a dedicated success manager instead of a bigger discount?'],
  people: [
    { name: 'Sarah', role: 'Sales lead, owns the Hartwell proposal' },
    { name: 'Omar', role: 'Finance (margin analysis, board deck)' },
    { name: 'Jake', role: "CEO's assistant (calendar, logistics)" },
    { name: 'Priya', role: 'Marketing / hiring (job description, webinar)' },
    { name: 'Marcus', role: 'Investor' },
  ],
  risks: ['Hartwell ($400K) may not renew over price', 'Board received a wrong churn figure (4% vs 5.2%)', 'Datafront webinar landing page may not be ready in time'],
  ideas: ['Offer Hartwell a dedicated success manager instead of a bigger discount'],
};
