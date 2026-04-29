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

...
looks a lot better. The ball is still disappearing mid flight to the outfield. I notice the batter disappears in some views. On another note this play: Contact: 112 mph, LA -15°, spray +44° (RF-line), 259 ft
Fielded by K. Zimmer (RF)
→ K. Foster: Single (off K. Zimmer, RF), it should

...

**_ Issue _**

- The runner on base situations are limited :
- No Runners, Runner at First, Runner at Second, Runner at 3rd
- Runners at First and Second, Runners at First and Third, Runners at First, Second and Third
- Runners at Second and Thrird

- Fielders should have logic to make descisions based on each runner condition.
- Fielders should know their responsibility when the ball is hit given each Runner Condition and Where the ball is hit.
- Fielders logic for these conditions are also based on the number of outs; ie 2 outs get the easy out. less than 2 outs is there a double play possible?
- Do we need to cut off the runner from scoring? This is a score based influence, if you are up by 5 runs with a hit to the outfield maybe the outfielder throws the ball to 2nd base to keep the runners from advancing rather than trying to get the runner at home, which would allow runners to advance on the long throw. There is also sacrific fly balls and infield fly rule.
- some are pure A happens do B, some should be "Can I make the throw in the moment?" which skill wise might be a roll.
- what is the best approach to using player intellegence (PI) to help players (runners and fielders) make these descisions. Should we work out the logic together?

- No runners - fielder focus on getting batter out.
- Runner at 1st base - fielder could try for double play > 2nd base throw to 1st. If there are 2 outs get the easy runner ie; first baseman fields the ball runs and tags first base - the lead runner is not priority.
- short stop fields the ball they could tag 2nd base or throw to the 2nd baseman on 2nd base. And vice versa for 2nd base.
- 3rd baseman also makes these decisions.
- Catcher makes this descision.
- Pitcher may need to run to 1st base if the first baseman fields the ball and goes to 2nd base for the double play.

**_ Context _**

- When the batter hits a ground ball to an infielder or generally into the infield a runner at first base must move towards 2nd base. This also applies with runners at 1st and 2nd (1st to 2nd and 2nd to 3rd), or 1st, 2nd and 3rd (bases loaded), if runners are at 1st and 3rd the runner at 1st base runner must move towards 2nd base, while the 3rd base runner can hold to wait for the play to develop, unless there are two outs then the 3rd base runner would take off to home.

- These situations allow fielders to make a decision about who to try and get out, and this is dependant on hit ball path and score. Fielder decisions - Double Play Ball? Go to First? Do I look the runner back then throw to first?

- These are pretty standard decsion making trees in baseball.
- The outfielders would be backing up bases incase the throw is off or the player misses the ball.

...

Q1: Players have a PI, Play Intellgence. this should be used to calculate decisions.
Q2, PI is part of a player skill set, it is not part of the box score. PI for now should influence defense and baserunning.
Q3. Keep player driven by now. Manager is down the road.
Q4. Cutoffs should be visuallized yes.

- Note 1st baseman typcially are in the infield and line themselves with the correct base to throw to. 1stbase men are used becuase relays are typically used when runners are going to 3rd or Home and no one is needed to cover 1st base; you use the 1st baseman. The pitcher backs up either home or 3rd depending on the throw from the outfield, they may actually wait between third and home until they know where the throw is going. A long single with the hitter/runner trying to get to second base - no runners on - to right field the 2nd baseman goes out, left field and center the short stop.

Q5: Infield Fly Rule: Must be less than two outs. runners at first and second, or first second and third, batter is automatically out. Ball must be fair. Runners cannot advance until the ball hits a fielder or ground - this applys to all fly balls. likely Runners would only advance on a bad error ie fielder drops the ball and the ball rolls away.

This prevents a dirty play where a fielder intentionally drops the ball to get easy double or triple play.

The parameters the ball needs to be a pop up, which is a judgement call. Lets start with 50 degrees LA and within +10 feet into the outfield where the infield and outfield meet.

...

Spray-aware r1→3rd difficulty — singles to RF make 3rd much easier than singles to LF
Tag-up PI — currently sacFlyTagProb is a flat constant; should be PI+speed gated
Steal attempts / pickoffs — the engine has none today; would need a new sub-module
Box-score / sim-lab UI surface — verify that the new behaviors look correct on the field render

Contact: 105 mph, LA 24°, spray -41° (LF-line), 364 ft, apex 62 ft — HR! < The ball visually did not go over the fence. could be pixel processing . I noticed this before.

On another home run the batter/runner still does not touch all the bases correctly.

Balls are still not rolling to a stop.

Also the ball should bounce off the wall or players. Eventually we will add more dynamic stadiums and the ball will need to bounce off other objects. The wall if its 10 feet should stop a ball at 9 feet the ball should bounce.
