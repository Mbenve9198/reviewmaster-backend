const resetPasswordEmailTemplate = (resetLink) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Reset your Replai password</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        body {
            margin: 0;
            padding: 0;
            background-color: #ffffff;
            font-family: 'Inter', sans-serif;
        }
    </style>
</head>
<body>
    <div style="margin: 0 auto; padding: 20px 0 48px; width: 560px;">
        <!-- Logo -->
        <div style="text-align: center; margin-bottom: 24px;">
            <img 
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Animation%20-%201735491929327-dY44cU5M8uSl9hi9DoaDdlyMKjdhIo.gif" 
                width="120" 
                height="120" 
                alt="Replai Logo" 
                style="margin: 0 auto;"
            />
        </div>

        <!-- Heading -->
        <h1 style="color: #1e90ff; font-size: 24px; font-weight: 600; line-height: 40px; margin: 0 0 20px; text-align: center;">
            Reset Your Password
        </h1>

        <!-- Main Text -->
        <p style="color: #333; font-size: 16px; line-height: 26px; margin: 0 0 20px; text-align: center;">
            We received a request to reset your password. Click the button below to create a new password:
        </p>

        <!-- Button Container -->
        <div style="text-align: center; margin: 30px 0;">
            <a 
                href="${resetLink}"
                style="
                    background-color: #1e90ff;
                    border-radius: 12px;
                    color: #fff;
                    font-size: 18px;
                    font-weight: bold;
                    text-decoration: none;
                    text-align: center;
                    display: inline-block;
                    box-shadow: 0 4px 0 0 #0066cc;
                    padding: 16px 32px;
                    mso-padding-alt: 0;
                    text-underline-color: #1e90ff;
                "
            >
                Reset Password
            </a>
        </div>

        <!-- Warning Text -->
        <p style="color: #333; font-size: 16px; line-height: 26px; margin: 0 0 20px; text-align: center;">
            If you didn't request this password reset, you can safely ignore this email.
        </p>

        <!-- Divider -->
        <hr style="border: none; border-top: 1px solid #e6e6e6; margin: 20px 0;">

        <!-- Footer -->
        <p style="color: #898989; font-size: 12px; line-height: 24px; text-align: center;">
            Replai is designed, built, and backed by StartupCafè Labs
        </p>
    </div>
</body>
</html>
`;

module.exports = resetPasswordEmailTemplate; 