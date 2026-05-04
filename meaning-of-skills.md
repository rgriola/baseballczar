# Revisted May 4 2026 @ 5:26pm; This are players on attributes on the database player table. 

# This is the source of truth for each player attributes andskills, whay they mean, and they should interact.  These skills were designed to manage both pitchers and batter/fielders. I have written up generally how they work to use as a guide for the final algorythmms in the sim engine. 

- Player Jersey Number; this is the number on their jersey. 
- Country - This is used to display their country flag, it is used in trades since some leagues limit international players or require them. 
- Player Name; hopefull self explanatory
- POS - If they are in the major league lineup this is their field position. There are no hard coded positions in baseballczar. Managers decide where players play depending on their positions skills and team needs.
- Status; True/False if they are on the active major league roster
- Age; players game age, ticks up one year after a full major league team season. This is used for player improvement, regression, injury, and retirement statuses and salary. These are not fully implimented yet. 
- HT; how tall a player is. This is not fully implimented yet. All players are considered 6' tall. 
- WT; how much a player weighs. This is not fully implimented yet. All players are considered 185 lbs. 
- B; the side of the plate a player bats from. Right, Left or Switch (R,L,S). Switch hitters bat from the opposite side of the plate as the pitchers throwing hand. Right Hand Pitcher - Switch Hitter Hits Left. Left Hand Pitcher - Switch Hitter Hits Right.  
- T; Throwing Hand. Left hand players do not play some positions, Catcher, Third, Shortstop because of the throw to first base. 

#### Player Skill Attributes are formulated at game time and are fractional, not rounded.

- SPD; Players flat out speed. 0 Speed = 5.3 Second 40 yard dash. 10 Speed = 4.2s 40 yard dash. Used in any base-running timing to run the bases and home to first. Also used in fielding range to get to the ball. 

- ST; Stamina this influences pitchers more than batters/fielders. Pitchers this affects their value of their pitching skills over the course of a game. After a certain number of pitches they get a slow decline.  ST will also effect how a player recovers from a game. For fielders they get a slight affect in skill decline over the course of a game and overall game recovery, batters/fielders play everyday back to back games, Stamina affects their fitness levels ie; a good player may need to rest and another player plays instead. 

- AG; Player agility. How easily a player can change directions and react to the ball either fielding or throwing or transisitioning the throw on a cutoff or double play. *HINT a manager would position a player with high SP and AG at SS or 2B. While Slower players may Catch(C) or 1B.  

- EYE; Batter Pitch Recognition, Pitcher Pitch Control? I am not sure how this works in pitching but it should influece the quality of a pitcher. In the Roster it would have a different name for the skill. 

- AVG; Batter inflences the quaility of their hitting, hitting the ball to gaps, down the line, powerallies, or fouling off close pitches. Pitchers opposite force. 

- STR; Could be called Power; How hard a player hits the ball, Pitchers how it offsets this. Hitting Attribute. Pitchers should have a MPH, it could be realated to this. 

- DHR; Doubles to Homeruns; I think we changed this to launch angle in hitting. This is a hidden attribute. Home Run Hitter v High Averger hitters. 

- PI; Play Intelligence informs the player descision making, Pitch selection, Batter descision making, Run/hit descisions. Pitchers influences the quaility of the pitch. 

- BNT is bunting for a hit. This is for a speciallized situation in the game we have not implimented yet. It can be hidden for now. Generally it is how well a batter bunts and the pitcher's defense defendes the bunt. Complicated.

- FLD; Fielding skills for fielders including Pitchers. This is coin flip on an a fielding-glove-throw event(if we have them yet).  MLB Error rates are quite small overall, so a 0 Skill may be 10% error fielding, 10 Skill is 1% error. To imagine a SS has to get the ball clean, make a decision based on game situation, excuture getting the out throw or possibly tag a player out.  PI + SPD + AG + FLD + TH + AG all contribute to fielding at different stages of the play. 

- TH; is how strong the player's arm is for both pitcher and fielder. 10 TH = 105mph, 0 TH = 80mph. 

- Karma; a factor that helps a player overcome challenging moments in the game. Affects both pitchers and hitters/fielders. Used only in high pressure situations. Hidden Attribute. 

- Salary; is how much a player costs per week of the season. We need to modify this. 

- Contract is years the player on contract. Not reallyy implimented yet. 







