Apr 17 2026

**_ Task _**

- This project folder contains an old baseball general manager simulator game I build in 2010. It was regular HTML - CSS - some JS and JQuery front end, Java to run daemons and PHP backend, mySQL db, it also ran on Apache (MAMP) system.

- Review and evaluate the feesibility of implimenting this project again.
- Include a general code review
- Stack
- security (but this may just be better later)
- I am open to some agent coding or translating of code to more update langugaes and stack elements (technology)
- This would be web based
  ...

**_ Task _**
Yes. Please Conduct a comprehensive review of the Baseballczar 2.0 project at this point. I will note some UI from the old project are not yet implimented but we will work on it over time.

- Create a master file called BBZAR_MASTER_REVIEW.md place it in the project root. Reference the below sections to keep the markdown files readable and not too long.
- Include the date and time the file was written at the top of each file.
- If not planned create a section in BBZAR_MASTER_REVIEW.md explaing how the project is structured, how the games are simulated (this was a heavy server function and the reason game sim ran separately from the website. I also ran daemons for Training and Trades based on the 1 time in 24 hours and when the trade window date ended. In its current state the site feels very slow. In testing the old version simulated an entire season in a couple minutes but our current test season sim seems to go very slow, previously I could see game sim logs in its own terminal and could monitor for issues this now happens in silence.) For gaming this is probably pretty important since these are different processes.

- Create a separate markdown for each area of concern:
  Correctness & Logic
  Security
  Architecture & Design
  - Game Sim
    Data Integrity
    Error Handling
    Performance
    Readability & Maintainability
    Testing
    Improvement Plan

- Update the README.md with appropriate infomation

...
**_ Issue _**

- starting Pitchers are not being rotated through the season. This will require some tracking mechanics to call the correcting starting pitcher for the game.
- This is typically tracked ie; Game 1 uses starter SP1, Game 2 uses SP2.
- the Bullpen has 5 pitchers, typically one is designated as a "closer" with a specific CL position; The positions are RP1, RP2, RP3, RP4 and CL. The Sim logic would use the CL in the end of the game to "close" out the game.
- The Pitcher Roster needs to allow 10 pitchers, no more no less, the rest are reserve and the Rotation page should have 10 pitchers 5 starters and the 5 Relievers.

...
Arp 28 2026
Yes > we are migrating to a new engine all together > Path — Full migration to the new engine. C reason: This project is in dev stage so we are going full out. The new sim needs a stand alone sandbox for quickly iterating games to make sure it works correctly ie; the outcomes, physics and eventual graphics. I also want to see what you can do!

...

Apr 28, there was an issue where a home run the runner did not touch the bases, rather traveled around the pitchers mound .
