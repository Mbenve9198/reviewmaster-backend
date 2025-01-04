const verificationEmailTemplate = (verificationLink) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Verify your Replai account</title>
</head>
<body>
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1>Welcome to Replai!</h1>
        <p>Thank you for registering. To complete your registration, please click the link below:</p>
        <p>
            <a href="${verificationLink}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Verify your account
            </a>
        </p>
        <p>If you didn't create this account, you can safely ignore this email.</p>
        <p style="margin-top: 20px; font-size: 12px; color: #666;">
            This email was sent by Replai.app
        </p>
    </div>
</body>
</html>
`;

module.exports = verificationEmailTemplate;