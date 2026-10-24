/**
 * HELIXO Quick-Start Guide PDF
 * Attached to welcome emails for new users
 */
import { jsPDF } from 'jspdf';

const NAVY = '#1e3a5f';
const DARK = '#111827';
const GRAY = '#6b7280';
const LIGHT_BG = '#f8fafc';

export function generateWelcomeGuidePdf(): string {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = 0;

  // --- Header ---
  doc.setFillColor(30, 58, 95);
  doc.rect(0, 0, W, 36, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text('HELIXO', W / 2, 18, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('QUICK-START GUIDE', W / 2, 28, { align: 'center' });
  y = 46;

  // --- Introduction ---
  doc.setTextColor(NAVY);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Welcome to HELIXO', 20, y);
  y += 8;
  doc.setTextColor(DARK);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const intro = 'HELIXO is your AI-powered performance dashboard for real-time revenue tracking, labor optimization, and forecasting. This guide covers the key sections you will use daily.';
  const introLines = doc.splitTextToSize(intro, W - 40);
  doc.text(introLines, 20, y);
  y += introLines.length * 5 + 10;

  // --- Section helper ---
  function section(num: string, title: string, desc: string, bullets: string[]) {
    // Section header
    doc.setFillColor(30, 58, 95);
    doc.roundedRect(20, y - 4, W - 40, 10, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`${num}  ${title}`, 24, y + 3);
    y += 12;

    // Description
    doc.setTextColor(DARK);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'normal');
    const descLines = doc.splitTextToSize(desc, W - 44);
    doc.text(descLines, 24, y);
    y += descLines.length * 4.5 + 3;

    // Bullets
    bullets.forEach(b => {
      doc.setTextColor(GRAY);
      doc.setFontSize(9);
      const bLines = doc.splitTextToSize(`•  ${b}`, W - 50);
      doc.text(bLines, 28, y);
      y += bLines.length * 4.2 + 1.5;
    });
    y += 4;

    // Page break check
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
  }

  // --- REPORTING SECTION ---
  doc.setTextColor(NAVY);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('REPORTING', 20, y);
  y += 8;

  section('1', 'Dashboard',
    'Your daily revenue and labor performance at a glance. Shows actuals vs budget vs projected for the current period.',
    [
      'Revenue: Net Sales, Budget, Variance, and Forecast columns',
      'FOH Labor: Actual vs Projected vs Budget with variance',
      'BOH Labor: Same breakdown by kitchen position',
      'Toggle between $ amounts and % of revenue view',
      'PTD (Period-to-Date) totals only sum days with actual data',
    ]);

  section('2', 'Labor Detail',
    'Position-by-position labor breakdown showing daily Projected, Budget, and Actual with variances.',
    [
      'FOH positions: Server, Bartender, Host, Support, Training',
      'BOH positions: Line Cooks, Prep Cooks, Dishwashers',
      'Color-coded: Green = under budget, Red = over budget',
      'Summary cards at top show FOH, BOH, and Total Labor totals',
    ]);

  section('3', 'Insights',
    'AI-generated daily narrative analyzing your restaurant performance. Available after the 5:00 AM data sync.',
    [
      'Revenue performance vs budget, forecast, and same day last year',
      'Covers, average check, and guest trends',
      'Sales mix breakdown (Food, Cocktails, Wine, Beer, etc.)',
      'Top menu items (PMIX) and biggest movers',
      'Labor variance flags for any position +/- 1.5% off target',
      'Hourly sales efficiency chart',
      'Manager Notes box at bottom for your daily comments',
    ]);

  section('4', 'Monthly Report',
    'Calendar-month view with the same revenue and labor columns as the Dashboard.',
    [
      'MTD Total: Only sums days with actual data',
      'Full Month Total: Blends actuals + forecast for future days',
    ]);

  // Page break
  doc.addPage();
  y = 20;

  // --- PLANNING SECTION ---
  doc.setTextColor(NAVY);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('PLANNING', 20, y);
  y += 8;

  section('5', 'Forecast Manager',
    'AI-suggested revenue forecasts for each day of the upcoming week. The forecast drives all projected labor targets.',
    [
      'AI blends 4 signals: trailing 2-week avg, prior year, momentum, and budget',
      'Accept the suggestion or Override with your own revenue number',
      'Covers are auto-calculated from revenue / trailing avg check',
      'Override tags explain why (Private Event, Holiday, Weather, etc.)',
      'Accepted forecasts lock automatically; only admins can unlock',
      'Deadline: Forecasts should be finalized by end of day Wednesday',
      'The comparison chart shows Forecast vs Budget vs SDLY vs Actuals',
    ]);

  section('6', 'Schedule Approval',
    'Compare your team\'s scheduled labor (from Dolce TeamWork) against the projected labor targets.',
    [
      'Projected labor is driven by the accepted forecast + threshold brackets',
      'Scheduled labor is pulled automatically from Dolce every Thursday at 1 PM',
      'Review FOH and BOH positions side by side',
      'Submit your schedule for director approval when ready',
      'Color coding: Orange = 5-10% over projected, Red = 10%+ over',
    ]);

  // --- WEEKLY WORKFLOW ---
  y += 4;
  doc.setTextColor(NAVY);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('WEEKLY WORKFLOW', 20, y);
  y += 10;

  const steps = [
    { day: 'Mon-Wed', action: 'Review AI forecast suggestions and accept or override for the upcoming week' },
    { day: 'Wednesday', action: 'Finalize all 7 days of forecast by end of day' },
    { day: 'Wed-Thu', action: 'Build schedules in Dolce TeamWork using projected labor as your guide' },
    { day: 'Thursday', action: 'Dolce schedule auto-syncs at 1:00 PM EST' },
    { day: 'Thursday', action: 'Review Schedule Approval tab and submit for director review' },
    { day: 'Daily', action: 'Check Dashboard and Insights after 5:30 AM for prior day performance' },
  ];

  steps.forEach((s, i) => {
    doc.setFillColor(i % 2 === 0 ? 248 : 241, i % 2 === 0 ? 250 : 245, i % 2 === 0 ? 252 : 249);
    doc.rect(20, y - 4, W - 40, 10, 'F');
    doc.setTextColor(NAVY);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.text(s.day, 24, y + 2);
    doc.setTextColor(DARK);
    doc.setFont('helvetica', 'normal');
    doc.text(s.action, 56, y + 2);
    y += 10;
  });

  y += 10;

  // --- Footer ---
  doc.setTextColor(GRAY);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Questions? Contact your director or visit helixokpi.com', W / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(8);
  doc.text('HELIXO | Performance Dashboard', W / 2, y, { align: 'center' });

  // Return base64
  return doc.output('datauristring').split(',')[1];
}
