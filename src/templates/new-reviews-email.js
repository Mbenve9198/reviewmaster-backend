const newReviewsEmailTemplate = (hotelName, newReviewsCount, platform, appUrl, isFirstSync = false) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${isFirstSync ? 'Integration Setup Complete' : `New Reviews for ${hotelName}`}</title>
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
        <!-- Heading -->
        <h1 style="color: #1e90ff; font-size: 24px; font-weight: 600; line-height: 40px; margin: 0 0 20px; text-align: center;">
            ${isFirstSync ? 'Integration Setup Complete' : 'New Reviews Alert'}
        </h1>

        <!-- Main Text -->
        <p style="color: #333; font-size: 16px; line-height: 26px; margin: 0 0 20px; text-align: center;">
            ${isFirstSync 
                ? `Your ${platform} integration has been set up successfully! We've imported your first ${newReviewsCount} reviews.`
                : `We've just imported ${newReviewsCount} new reviews for ${hotelName} from ${platform}.`
            }
            ${!isFirstSync ? 'Stay on top of your online reputation by responding promptly to these new reviews.' : ''}
        </p>

        <!-- Button Container -->
        <div style="text-align: center; margin: 30px 0;">
            <a 
                href="${appUrl}/reviews"
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
                ${isFirstSync ? 'View Imported Reviews' : 'Respond to Reviews'}
            </a>
        </div>

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

module.exports = newReviewsEmailTemplate; 