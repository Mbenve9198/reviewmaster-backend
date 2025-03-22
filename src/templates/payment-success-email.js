const paymentSuccessEmailTemplate = (userName, amount, creditsAmount, dashboardUrl, isAutoTopUp) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Successful</title>
  <style>
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f9f9f9;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #ffffff;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }
    .header {
      text-align: center;
      padding-bottom: 20px;
      border-bottom: 1px solid #f0f0f0;
    }
    .logo {
      max-width: 150px;
      margin-bottom: 10px;
    }
    .content {
      padding: 30px 20px;
    }
    .success-alert {
      background-color: #dcfce7;
      border-left: 4px solid #22c55e;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 4px;
    }
    .details {
      background-color: #f7f7f7;
      padding: 20px;
      border-radius: 6px;
      margin-bottom: 20px;
    }
    .details-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      border-bottom: 1px dashed #e5e5e5;
      padding-bottom: 10px;
    }
    .details-row:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }
    .cta-button {
      display: inline-block;
      background-color: #3b82f6;
      color: #ffffff;
      text-decoration: none;
      padding: 12px 25px;
      border-radius: 6px;
      font-weight: 600;
      margin-right: 10px;
      margin-bottom: 10px;
    }
    .footer {
      text-align: center;
      padding-top: 20px;
      border-top: 1px solid #f0f0f0;
      font-size: 12px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://replai.app/logo.png" alt="Replai Logo" class="logo">
      <h1>Payment Successful</h1>
    </div>
    
    <div class="content">
      <div class="success-alert">
        <strong>${isAutoTopUp ? 'Your automatic top-up was successful' : 'Your payment was successful'}</strong>
      </div>
      
      <p>Hello ${userName},</p>
      
      <p>We're pleased to confirm that ${isAutoTopUp ? 'your automatic top-up' : 'your payment'} has been successfully processed.</p>
      
      <div class="details">
        <div class="details-row">
          <span>Amount:</span>
          <strong>€${amount.toFixed(2)}</strong>
        </div>
        <div class="details-row">
          <span>Credits Added:</span>
          <strong>${creditsAmount}</strong>
        </div>
        <div class="details-row">
          <span>Status:</span>
          <strong style="color: #22c55e;">Completed</strong>
        </div>
        <div class="details-row">
          <span>Date:</span>
          <strong>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>
        </div>
      </div>
      
      <p>Your credits have been added to your account and are ready to use.</p>
      
      <p>
        <a href="${dashboardUrl}" class="cta-button">Go to Dashboard</a>
      </p>
      
      <p>Thank you for your business!</p>
      
      <p>Best regards,<br>
      The Replai Team</p>
    </div>
    
    <div class="footer">
      <p>© ${new Date().getFullYear()} Replai. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
};

module.exports = paymentSuccessEmailTemplate; 