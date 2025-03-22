const paymentFailedEmailTemplate = (userName, amount, creditsAmount, dashboardUrl, reason) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Failed</title>
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
    .alert {
      background-color: #fee2e2;
      border-left: 4px solid #ef4444;
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
    .cta-button.secondary {
      background-color: #6b7280;
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
      <h1>Payment Failed</h1>
    </div>
    
    <div class="content">
      <div class="alert">
        <strong>Your automatic top-up payment has failed.</strong>
      </div>
      
      <p>Hello ${userName},</p>
      
      <p>We're writing to let you know that we were unable to process your automatic top-up payment. Your card was declined with the following reason:</p>
      
      <p><strong>${reason || 'Insufficient funds'}</strong></p>
      
      <div class="details">
        <div class="details-row">
          <span>Amount:</span>
          <strong>€${amount.toFixed(2)}</strong>
        </div>
        <div class="details-row">
          <span>Credits:</span>
          <strong>${creditsAmount}</strong>
        </div>
        <div class="details-row">
          <span>Status:</span>
          <strong style="color: #ef4444;">Failed</strong>
        </div>
      </div>
      
      <p>To continue using all features without interruption, please update your payment method or add funds to your account.</p>
      
      <p>
        <a href="${dashboardUrl}/billing" class="cta-button">Update Payment Method</a>
        <a href="${dashboardUrl}" class="cta-button secondary">Go to Dashboard</a>
      </p>
      
      <p>If you need any assistance, please don't hesitate to contact our support team.</p>
      
      <p>Thank you,<br>
      The Replai Team</p>
    </div>
    
    <div class="footer">
      <p>© ${new Date().getFullYear()} Replai. All rights reserved.</p>
      <p>If you did not request this email, please ignore it.</p>
    </div>
  </div>
</body>
</html>
  `;
};

module.exports = paymentFailedEmailTemplate; 