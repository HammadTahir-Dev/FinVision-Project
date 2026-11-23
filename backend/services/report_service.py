"""
services/report_service.py — Report generation for FinVision.

Responsibilities:
  1. Generate structured financial report narrative via Groq API
  2. Combine RAG insights + forecast data into one report
  3. Export report to PDF using ReportLab
  4. Export report to Excel using openpyxl
  5. Save report files to disk and return paths
"""

import os
import logging
import json
from datetime import datetime
from typing import Optional

from groq import Groq
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table,
    TableStyle, HRFlowable, PageBreak,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.chart import LineChart, Reference

from config import get_settings

logger   = logging.getLogger(__name__)
settings = get_settings()


# ── Groq Client ───────────────────────────────────────────────────────────────

def get_groq_client() -> Groq:
    return Groq(api_key=settings.groq_api_key)


# ── Report Narrative Generation ───────────────────────────────────────────────

def generate_report_narrative(
    report_type:   str,
    company_name:  str,
    period:        str,
    rag_context:   Optional[str],
    forecast_data: Optional[dict],
    db_settings:   dict,
) -> dict:
    """
    Generate a structured financial report using Groq API.
    Returns sections dict with Executive Summary, Analysis, Forecast, Recommendations.
    """
    llm_model = db_settings.get("llm_model", settings.default_llm_model)

    # Build context for the LLM
    context_parts = []

    if rag_context:
        context_parts.append(f"FINANCIAL DATA FROM DOCUMENTS:\n{rag_context}")

    if forecast_data:
        kpis = forecast_data.get("kpis", {})
        context_parts.append(
            f"FORECAST DATA:\n"
            f"Metric: {kpis.get('metric', 'Revenue')}\n"
            f"Current Value: {kpis.get('current_value', 'N/A')}\n"
            f"Next Period Forecast: {kpis.get('next_period', 'N/A')}\n"
            f"YoY Growth: {kpis.get('yoy_growth_pct', 'N/A')}%\n"
            f"Forecast Total: {kpis.get('forecast_total', 'N/A')}\n"
            f"Confidence: {kpis.get('confidence_pct', 'N/A')}%"
        )

    context = "\n\n".join(context_parts) if context_parts else "No financial data provided."

    system_prompt = """You are an expert financial analyst generating a professional financial report.
Generate a structured report with these exact sections, each clearly labeled:

[EXECUTIVE_SUMMARY]
2-3 paragraph overview of the financial situation and key findings.

[KEY_METRICS]
List 5-7 key financial metrics and their values found in the data.

[TREND_ANALYSIS]
2-3 paragraphs analyzing trends, patterns, and notable observations in the data.

[FORECAST_ANALYSIS]
2 paragraphs interpreting the forecast data and what it means for the business.

[RECOMMENDATIONS]
5-7 specific, actionable recommendations based on the data.

[RISK_FACTORS]
3-5 key risks identified from the financial data.

Rules:
- Use ONLY data from the provided context
- Be specific with numbers and percentages
- Write professionally and concisely
- If data is missing for a section, say so clearly"""

    user_prompt = f"""Generate a {report_type} financial report for {company_name} for the period: {period}

{context}

Generate the complete report now."""

    # Shared helper: handles reasoning models (gpt-oss) that otherwise return
    # an empty reply, which crashed section parsing with None.
    from services.rag_service import llm_complete
    full_text = llm_complete(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        llm_model, max_tokens=4000, temperature=0.3,
    )
    if not full_text:
        raise ValueError("The AI model returned an empty report. Please try again.")

    # Parse sections
    sections = parse_report_sections(full_text)
    sections["full_text"]    = full_text
    sections["company_name"] = company_name
    sections["period"]       = period
    sections["report_type"]  = report_type
    sections["generated_at"] = datetime.utcnow().isoformat()

    return sections


def parse_report_sections(text: str) -> dict:
    """Parse the LLM output into structured sections."""
    section_keys = [
        "EXECUTIVE_SUMMARY",
        "KEY_METRICS",
        "TREND_ANALYSIS",
        "FORECAST_ANALYSIS",
        "RECOMMENDATIONS",
        "RISK_FACTORS",
    ]

    sections = {}
    for i, key in enumerate(section_keys):
        start_tag = f"[{key}]"
        end_tag   = f"[{section_keys[i+1]}]" if i + 1 < len(section_keys) else None

        start_idx = text.find(start_tag)
        if start_idx == -1:
            sections[key.lower()] = ""
            continue

        start_idx += len(start_tag)
        end_idx    = text.find(end_tag) if end_tag else len(text)
        sections[key.lower()] = text[start_idx:end_idx].strip()

    return sections


def _pdf_text(text: str) -> str:
    """Escape for ReportLab and keep **bold** from the LLM's markdown."""
    from xml.sax.saxutils import escape
    import re as _re
    t = escape(text)
    t = _re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    return t.replace("**", "").lstrip("#").strip()


# ── PDF Export ────────────────────────────────────────────────────────────────

def export_pdf(
    sections:    dict,
    output_path: str,
) -> int:
    """
    Generate a professional PDF report using ReportLab.
    Returns page count.
    """
    doc    = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=0.75*inch,
        leftMargin=0.75*inch,
        topMargin=inch,
        bottomMargin=0.75*inch,
    )
    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        "CustomTitle",
        parent=styles["Title"],
        fontSize=24,
        textColor=colors.HexColor("#1a1a2e"),
        spaceAfter=6,
        alignment=TA_CENTER,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle",
        parent=styles["Normal"],
        fontSize=12,
        textColor=colors.HexColor("#4a4a6a"),
        spaceAfter=4,
        alignment=TA_CENTER,
    )
    heading_style = ParagraphStyle(
        "SectionHeading",
        parent=styles["Heading1"],
        fontSize=14,
        textColor=colors.HexColor("#1a1a2e"),
        spaceBefore=16,
        spaceAfter=8,
        borderPad=4,
    )
    body_style = ParagraphStyle(
        "BodyText",
        parent=styles["Normal"],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#333333"),
        spaceAfter=8,
        alignment=TA_JUSTIFY,
    )
    bullet_style = ParagraphStyle(
        "BulletText",
        parent=styles["Normal"],
        fontSize=10,
        leading=14,
        leftIndent=20,
        spaceAfter=4,
        textColor=colors.HexColor("#333333"),
    )

    story = []

    # ── Cover ─────────────────────────────────────────────────────────────────
    story.append(Spacer(1, inch))
    story.append(Paragraph("FinVision", title_style))
    story.append(Paragraph(f"{_pdf_text(sections.get('report_type', 'Financial'))} Report", subtitle_style))
    story.append(Paragraph(_pdf_text(sections.get("company_name", "Company")), subtitle_style))
    story.append(Paragraph(f"Period: {_pdf_text(sections.get('period', ''))}", subtitle_style))
    story.append(Paragraph(f"Generated: {datetime.utcnow().strftime('%B %d, %Y')}", subtitle_style))
    story.append(Spacer(1, 0.3*inch))
    story.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#4CAF50")))
    story.append(Spacer(1, 0.5*inch))

    # ── Sections ──────────────────────────────────────────────────────────────
    section_titles = {
        "executive_summary": "Executive Summary",
        "key_metrics":       "Key Metrics",
        "trend_analysis":    "Trend Analysis",
        "forecast_analysis": "Forecast Analysis",
        "recommendations":   "Recommendations",
        "risk_factors":      "Risk Factors",
    }

    for key, title in section_titles.items():
        content = sections.get(key, "")
        if not content:
            continue

        story.append(Paragraph(title, heading_style))
        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#cccccc")))
        story.append(Spacer(1, 0.1*inch))

        # Split into lines and render
        lines = content.split("\n")
        for line in lines:
            line = line.strip()
            if not line:
                continue
            # Escape &, <, > (e.g. "R&D", "<5%") — ReportLab treats text as markup
            if line.startswith("-") or line.startswith("•") or line[0].isdigit():
                story.append(Paragraph(f"• {_pdf_text(line.lstrip('-•*0123456789. '))}", bullet_style))
            else:
                story.append(Paragraph(_pdf_text(line), body_style))

        story.append(Spacer(1, 0.2*inch))

    # ── Footer note ───────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.5*inch))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#cccccc")))
    story.append(Paragraph(
        "This report was generated by FinVision AI. All insights are based on provided financial data.",
        ParagraphStyle("Footer", parent=styles["Normal"], fontSize=8,
                       textColor=colors.gray, alignment=TA_CENTER)
    ))

    doc.build(story)

    # Count pages (PyPDF2 was imported here but is not a dependency, so every
    # PDF export failed; PyMuPDF is already installed for PDF parsing)
    try:
        import fitz
        with fitz.open(output_path) as pdf:
            page_count = pdf.page_count
    except Exception:
        page_count = 1

    logger.info(f"✅ PDF generated: {output_path} ({page_count} pages)")
    return page_count


# ── Excel Export ──────────────────────────────────────────────────────────────

def export_excel(
    sections:      dict,
    forecast_data: Optional[dict],
    output_path:   str,
) -> None:
    """
    Generate an Excel report with multiple sheets:
    - Summary: key metrics and report narrative
    - Forecast Data: chart data table
    - Charts: embedded line chart
    """
    wb = openpyxl.Workbook()

    # ── Colors and styles ─────────────────────────────────────────────────────
    header_fill   = PatternFill("solid", fgColor="1a1a2e")
    accent_fill   = PatternFill("solid", fgColor="4CAF50")
    alt_fill      = PatternFill("solid", fgColor="f5f5f5")
    header_font   = Font(color="FFFFFF", bold=True, size=11)
    title_font    = Font(color="1a1a2e", bold=True, size=16)
    section_font  = Font(color="1a1a2e", bold=True, size=12)
    body_font     = Font(color="333333", size=10)
    center_align  = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left_align    = Alignment(horizontal="left",   vertical="top",    wrap_text=True)

    thin_border = Border(
        left=Side(style="thin", color="cccccc"),
        right=Side(style="thin", color="cccccc"),
        top=Side(style="thin", color="cccccc"),
        bottom=Side(style="thin", color="cccccc"),
    )

    # ── Sheet 1: Summary ──────────────────────────────────────────────────────
    ws1 = wb.active
    ws1.title = "Executive Summary"
    ws1.column_dimensions["A"].width = 25
    ws1.column_dimensions["B"].width = 70

    # Title
    ws1.merge_cells("A1:B1")
    ws1["A1"] = f"FinVision — {sections.get('report_type', 'Financial')} Report"
    ws1["A1"].font      = title_font
    ws1["A1"].fill      = header_fill
    ws1["A1"].alignment = center_align
    ws1["A1"].font      = Font(color="FFFFFF", bold=True, size=16)
    ws1.row_dimensions[1].height = 40

    ws1.merge_cells("A2:B2")
    ws1["A2"] = f"{sections.get('company_name', '')} | {sections.get('period', '')} | Generated: {datetime.utcnow().strftime('%Y-%m-%d')}"
    ws1["A2"].alignment = center_align
    ws1["A2"].fill      = PatternFill("solid", fgColor="2d2d4e")
    ws1["A2"].font      = Font(color="FFFFFF", size=10)

    # Sections
    row = 4
    section_titles = {
        "executive_summary": "Executive Summary",
        "key_metrics":       "Key Metrics",
        "trend_analysis":    "Trend Analysis",
        "forecast_analysis": "Forecast Analysis",
        "recommendations":   "Recommendations",
        "risk_factors":      "Risk Factors",
    }

    for key, title in section_titles.items():
        content = sections.get(key, "")
        if not content:
            continue

        # Section header
        ws1.merge_cells(f"A{row}:B{row}")
        ws1[f"A{row}"] = title
        ws1[f"A{row}"].font      = Font(color="FFFFFF", bold=True, size=11)
        ws1[f"A{row}"].fill      = accent_fill
        ws1[f"A{row}"].alignment = left_align
        ws1.row_dimensions[row].height = 22
        row += 1

        # Content
        ws1.merge_cells(f"A{row}:B{row}")
        ws1[f"A{row}"] = content
        ws1[f"A{row}"].font      = body_font
        ws1[f"A{row}"].alignment = left_align
        ws1[f"A{row}"].fill      = alt_fill if (row % 2 == 0) else PatternFill()
        ws1.row_dimensions[row].height = max(60, len(content) // 3)
        row += 2

    # ── Sheet 2: Forecast Data ────────────────────────────────────────────────
    if forecast_data and forecast_data.get("chart_data"):
        ws2 = wb.create_sheet("Forecast Data")
        ws2.column_dimensions["A"].width = 12
        ws2.column_dimensions["B"].width = 15
        ws2.column_dimensions["C"].width = 15
        ws2.column_dimensions["D"].width = 15
        ws2.column_dimensions["E"].width = 15

        # Headers
        headers = ["Date", "Actual", "Expected", "Best Case", "Worst Case"]
        for col, header in enumerate(headers, 1):
            cell = ws2.cell(row=1, column=col, value=header)
            cell.font      = header_font
            cell.fill      = header_fill
            cell.alignment = center_align

        # Data rows
        chart_data = forecast_data["chart_data"]
        for i, point in enumerate(chart_data, 2):
            ws2.cell(row=i, column=1, value=point.get("date"))
            ws2.cell(row=i, column=2, value=point.get("actual"))
            ws2.cell(row=i, column=3, value=point.get("expected"))
            ws2.cell(row=i, column=4, value=point.get("best"))
            ws2.cell(row=i, column=5, value=point.get("worst"))

            if i % 2 == 0:
                for col in range(1, 6):
                    ws2.cell(row=i, column=col).fill = alt_fill

        # Add line chart
        chart      = LineChart()
        chart.title = f"{forecast_data.get('kpis', {}).get('metric', 'Revenue')} Forecast"
        chart.style = 10
        chart.y_axis.title = "Value"
        chart.x_axis.title = "Period"
        chart.width  = 20
        chart.height = 12

        total_rows = len(chart_data) + 1
        actual_ref   = Reference(ws2, min_col=2, min_row=1, max_row=total_rows)
        expected_ref = Reference(ws2, min_col=3, min_row=1, max_row=total_rows)
        best_ref     = Reference(ws2, min_col=4, min_row=1, max_row=total_rows)
        worst_ref    = Reference(ws2, min_col=5, min_row=1, max_row=total_rows)

        chart.add_data(actual_ref,   titles_from_data=True)
        chart.add_data(expected_ref, titles_from_data=True)
        chart.add_data(best_ref,     titles_from_data=True)
        chart.add_data(worst_ref,    titles_from_data=True)

        ws2.add_chart(chart, "G2")

        # KPI Sheet
        ws3 = wb.create_sheet("KPI Summary")
        ws3.column_dimensions["A"].width = 30
        ws3.column_dimensions["B"].width = 20

        ws3.merge_cells("A1:B1")
        ws3["A1"] = "KPI Summary"
        ws3["A1"].font      = Font(color="FFFFFF", bold=True, size=14)
        ws3["A1"].fill      = header_fill
        ws3["A1"].alignment = center_align
        ws3.row_dimensions[1].height = 30

        kpis = forecast_data.get("kpis", {})
        kpi_rows = [
            ("Metric",            kpis.get("metric", "")),
            ("Current Value",     kpis.get("current_value", "")),
            ("Next Period Forecast", kpis.get("next_period", "")),
            ("YoY Growth %",      f"{kpis.get('yoy_growth_pct', '')}%"),
            ("Forecast Total",    kpis.get("forecast_total", "")),
            ("Best Case Total",   kpis.get("forecast_best", "")),
            ("Worst Case Total",  kpis.get("forecast_worst", "")),
            ("Confidence %",      f"{kpis.get('confidence_pct', '')}%"),
            ("Data Points",       kpis.get("data_points", "")),
        ]

        for i, (label, value) in enumerate(kpi_rows, 2):
            ws3.cell(row=i, column=1, value=label).font  = Font(bold=True, size=10)
            ws3.cell(row=i, column=2, value=value).font  = body_font
            if i % 2 == 0:
                ws3.cell(row=i, column=1).fill = alt_fill
                ws3.cell(row=i, column=2).fill = alt_fill

    wb.save(output_path)
    logger.info(f"✅ Excel generated: {output_path}")


# ── Main Entry Point ──────────────────────────────────────────────────────────

def generate_report(
    user_id:       int,
    report_type:   str,
    company_name:  str,
    period:        str,
    rag_context:   Optional[str],
    forecast_data: Optional[dict],
    db_settings:   dict,
    output_dir:    str,
) -> dict:
    """
    Full report generation pipeline.
    Returns paths and metadata for the generated report.
    """
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe_name = report_type.replace(" ", "_").lower()

    pdf_path   = os.path.join(output_dir, f"report_{user_id}_{safe_name}_{timestamp}.pdf")
    excel_path = os.path.join(output_dir, f"report_{user_id}_{safe_name}_{timestamp}.xlsx")

    os.makedirs(output_dir, exist_ok=True)

    # Generate narrative
    logger.info(f"Generating {report_type} report for {company_name}...")
    sections = generate_report_narrative(
        report_type, company_name, period,
        rag_context, forecast_data, db_settings,
    )

    # Export PDF
    try:
        page_count = export_pdf(sections, pdf_path)
    except Exception as e:
        logger.error(f"PDF export failed: {e}")
        page_count = 0
        pdf_path   = None

    # Export Excel
    try:
        export_excel(sections, forecast_data, excel_path)
        excel_size = os.path.getsize(excel_path) // 1024
    except Exception as e:
        logger.error(f"Excel export failed: {e}")
        excel_path = None
        excel_size = 0

    pdf_size = os.path.getsize(pdf_path) // 1024 if pdf_path else 0

    return {
        "title":       f"{report_type} Report — {company_name}",
        "report_type": report_type,
        "company":     company_name,
        "period":      period,
        "sections":    sections,
        "pdf_path":    pdf_path,
        "excel_path":  excel_path,
        "page_count":  page_count,
        "pdf_size_kb": pdf_size,
        "excel_size_kb": excel_size,
    }
