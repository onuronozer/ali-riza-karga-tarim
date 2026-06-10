import type { ReportBreakdownItem, ReportOverview, ReportsSnapshot } from '../../shared/ipc-contracts/app-api';
import { getDatabase } from '../db/connection';
import { ensureActiveSeason } from './catalogService';

interface OverviewRow {
  total_gram: number;
  total_amount_kurus: number;
  receipt_count: number;
  farmer_count: number;
  company_count: number;
  paid_to_farmers_kurus: number;
  collected_from_companies_kurus: number;
  farmer_balance_total_kurus: number;
  company_balance_total_kurus: number;
}

interface BreakdownRow {
  name: string;
  total_gram: number;
  total_amount_kurus: number;
  receipt_count: number;
}

function mapOverview(row: OverviewRow | undefined): ReportOverview {
  return {
    totalGram: row?.total_gram ?? 0,
    totalAmountKurus: row?.total_amount_kurus ?? 0,
    receiptCount: row?.receipt_count ?? 0,
    farmerCount: row?.farmer_count ?? 0,
    companyCount: row?.company_count ?? 0,
    paidToFarmersKurus: row?.paid_to_farmers_kurus ?? 0,
    collectedFromCompaniesKurus: row?.collected_from_companies_kurus ?? 0,
    farmerBalanceTotalKurus: row?.farmer_balance_total_kurus ?? 0,
    companyBalanceTotalKurus: row?.company_balance_total_kurus ?? 0
  };
}

function mapBreakdown(row: BreakdownRow): ReportBreakdownItem {
  return {
    name: row.name,
    totalGram: row.total_gram,
    totalAmountKurus: row.total_amount_kurus,
    receiptCount: row.receipt_count
  };
}

export function getReportsSnapshot(): ReportsSnapshot {
  const db = getDatabase();
  const season = ensureActiveSeason();
  const overviewRow = db
    .prepare(
      `
      SELECT total_gram, total_amount_kurus, receipt_count, farmer_count, company_count,
             paid_to_farmers_kurus, collected_from_companies_kurus,
             farmer_balance_total_kurus, company_balance_total_kurus
      FROM season_summaries
      WHERE season_id = ?
      `
    )
    .get(season.id) as OverviewRow | undefined;

  const byCompany = db
    .prepare(
      `
      SELECT company_name AS name,
             COALESCE(SUM(total_gram), 0) AS total_gram,
             COALESCE(SUM(total_amount_kurus), 0) AS total_amount_kurus,
             COALESCE(SUM(receipt_count), 0) AS receipt_count
      FROM daily_company_summaries
      WHERE season_id = ?
      GROUP BY company_id, company_name
      ORDER BY total_gram DESC
      LIMIT 100
      `
    )
    .all(season.id) as BreakdownRow[];

  const byType = db
    .prepare(
      `
      SELECT apricot_type_name AS name,
             COALESCE(SUM(total_gram), 0) AS total_gram,
             COALESCE(SUM(total_amount_kurus), 0) AS total_amount_kurus,
             COALESCE(SUM(receipt_count), 0) AS receipt_count
      FROM daily_type_summaries
      WHERE season_id = ?
      GROUP BY apricot_type_id, apricot_type_name
      ORDER BY total_gram DESC
      LIMIT 100
      `
    )
    .all(season.id) as BreakdownRow[];

  return {
    overview: mapOverview(overviewRow),
    byCompany: byCompany.map(mapBreakdown),
    byType: byType.map(mapBreakdown)
  };
}
