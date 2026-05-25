'use strict';

/**
 * Generates HTML for a payslip.
 * @param {Object} data - Payslip data.
 * @returns {string} - HTML string.
 */
function generatePayslipHtml(data) {
  const { 
    name, employee_id, designation, department,
    month, year, basic, hra, da, allowances, deductions, net_salary,
    payment_date, payment_mode,
    school_name, school_address, logo_url
  } = data;

  const monthName = new Date(0, month - 1).toLocaleString('default', { month: 'long' });
  const totalEarnings = Number(basic) + Number(hra) + Number(da) + Number(allowances);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Helvetica', 'Arial', sans-serif; color: #333; margin: 0; padding: 40px; }
        .container { max-width: 800px; margin: auto; border: 1px solid #eee; padding: 30px; border-radius: 20px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f97316; padding-bottom: 20px; margin-bottom: 30px; }
        .school-info h1 { margin: 0; font-size: 24px; color: #7c2d12; }
        .school-info p { margin: 5px 0 0; font-size: 12px; color: #666; }
        .payslip-title { text-align: right; }
        .payslip-title h2 { margin: 0; font-size: 20px; color: #f97316; }
        .payslip-title p { margin: 5px 0 0; font-size: 14px; font-weight: bold; }
        
        .staff-info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; background: #fff7ed; padding: 20px; border-radius: 15px; margin-bottom: 30px; }
        .info-group label { display: block; font-size: 10px; font-weight: bold; text-transform: uppercase; color: #9a3412; margin-bottom: 5px; }
        .info-group span { font-size: 14px; font-weight: bold; }

        .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 30px; }
        .section-title { font-size: 12px; font-weight: bold; text-transform: uppercase; border-bottom: 1px dashed #ddd; padding-bottom: 10px; margin-bottom: 15px; color: #666; }
        .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f5f5f5; font-size: 13px; }
        .row.total { border-top: 2px solid #eee; border-bottom: none; font-weight: bold; margin-top: 10px; }

        .footer { border-top: 1px solid #eee; pt: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
        .payment-info p { margin: 5px 0; font-size: 12px; }
        .net-salary { text-align: right; }
        .net-salary label { font-size: 12px; font-weight: bold; text-transform: uppercase; color: #666; }
        .net-salary .amount { font-size: 32px; font-weight: 900; color: #f97316; }

        .disclaimer { text-align: center; margin-top: 40px; font-size: 10px; color: #999; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="school-info">
            <h1>${school_name || 'EduCore School'}</h1>
            <p>${school_address || ''}</p>
          </div>
          <div class="payslip-title">
            <h2>SALARY SLIP</h2>
            <p>${monthName} ${year}</p>
          </div>
        </div>

        <div class="staff-info">
          <div class="info-group">
            <label>Staff Member</label>
            <span>${name}</span>
            <p style="margin: 3px 0; font-size: 11px; color: #9a3412;">${employee_id}</p>
          </div>
          <div class="info-group" style="text-align: right;">
            <label>Designation</label>
            <span>${designation || '--'}</span>
            <p style="margin: 3px 0; font-size: 11px; color: #9a3412;">${department || '--'}</p>
          </div>
        </div>

        <div class="details-grid">
          <div>
            <div class="section-title">Earnings</div>
            <div class="row"><span>Basic Salary</span><span>${basic}</span></div>
            <div class="row"><span>HRA</span><span>${hra}</span></div>
            <div class="row"><span>DA</span><span>${da}</span></div>
            <div class="row"><span>Allowances</span><span>${allowances}</span></div>
            <div class="row total"><span>Total Earnings</span><span>${totalEarnings.toFixed(2)}</span></div>
          </div>
          <div>
            <div class="section-title">Deductions</div>
            <div class="row"><span>Total Deductions</span><span>${deductions}</span></div>
            <div class="row total"><span>Total Deductions</span><span>${deductions}</span></div>
          </div>
        </div>

        <div class="footer">
          <div class="payment-info">
            <p><strong>Payment Mode:</strong> ${payment_mode || '--'}</p>
            <p><strong>Paid On:</strong> ${payment_date ? new Date(payment_date).toLocaleDateString() : '--'}</p>
          </div>
          <div class="net-salary">
            <label>Net Salary Disbursed</label>
            <div class="amount">₹${net_salary}</div>
          </div>
        </div>

        <div class="disclaimer">
          This is a computer-generated document and does not require a physical signature.
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = { generatePayslipHtml };
